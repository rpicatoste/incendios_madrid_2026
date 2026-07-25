import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RETENTION_DAYS = 90;
const SESSION_WINDOW_MS = 30 * 60 * 1000;
const WRITE_THROTTLE_MS = 60 * 1000;
const dataDirectory = process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const analyticsFile = join(dataDirectory, "analytics.json");
const configuredToken = process.env.FOCO_ANALYTICS_TOKEN || "";

type VisitorRecord = {
  firstSeen: string;
  lastSeen: string;
  lastSessionAt: string;
  sessions: number;
};

type DayRecord = {
  visits: number;
  visitors: Record<string, VisitorRecord>;
  countries: Record<string, number>;
};

type AnalyticsStore = {
  schemaVersion: 1;
  startedAt: string;
  updatedAt: string;
  days: Record<string, DayRecord>;
};

export type AnalyticsSummary = {
  trackingStartedAt: string;
  lastVisitAt: string;
  today: { uniqueVisitors: number; visits: number };
  last7Visits: number;
  last30Visits: number;
  retainedVisits: number;
  recentDays: Array<{ date: string; uniqueVisitors: number; visits: number }>;
  topCountries: Array<{ country: string; visits: number }>;
};

let writeQueue: Promise<unknown> = Promise.resolve();

const withWriteLock = async <T,>(operation: () => Promise<T>) => {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
};

const emptyStore = (): AnalyticsStore => {
  const now = new Date().toISOString();
  return { schemaVersion: 1, startedAt: now, updatedAt: now, days: {} };
};

const readStore = async (): Promise<AnalyticsStore> => {
  try {
    const parsed = JSON.parse(await readFile(analyticsFile, "utf8")) as Partial<AnalyticsStore>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.updatedAt !== "string" ||
      !parsed.days ||
      typeof parsed.days !== "object"
    ) {
      return emptyStore();
    }
    return parsed as AnalyticsStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
};

const saveStore = async (store: AnalyticsStore) => {
  await mkdir(dirname(analyticsFile), { recursive: true });
  const temporaryFile = `${analyticsFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(store), { mode: 0o600 });
    await rename(temporaryFile, analyticsFile);
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
};

const isAutomatedAgent = (userAgent: string) =>
  /bot|crawler|spider|preview|headless|lighthouse|monitor|uptime|curl|wget/i.test(userAgent);

const visitorAddress = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  "local";

const visitorCountry = (request: Request) => {
  const value = (request.headers.get("cf-ipcountry") || "").toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : "--";
};

const cutoffDate = (now: number) =>
  new Date(now - (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

export const recordVisitor = async (request: Request) => {
  if (configuredToken.length < 32) return;
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return;
  const userAgent = request.headers.get("user-agent") || "";
  if (!userAgent || isAutomatedAgent(userAgent)) return;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const dayKey = nowIso.slice(0, 10);
  const fingerprint = createHmac("sha256", configuredToken)
    .update(`${dayKey}\0${visitorAddress(request)}\0${userAgent}`)
    .digest("hex")
    .slice(0, 32);

  await withWriteLock(async () => {
    const store = await readStore();
    const cutoff = cutoffDate(now);
    for (const storedDay of Object.keys(store.days)) {
      if (storedDay < cutoff) delete store.days[storedDay];
    }

    const day = store.days[dayKey] || { visits: 0, visitors: {}, countries: {} };
    const previous = day.visitors[fingerprint];
    const previousSeen = previous ? Date.parse(previous.lastSeen) : Number.NaN;
    if (Number.isFinite(previousSeen) && now - previousSeen < WRITE_THROTTLE_MS) return;

    const previousSession = previous ? Date.parse(previous.lastSessionAt) : Number.NaN;
    const startsSession = !Number.isFinite(previousSession) || now - previousSession >= SESSION_WINDOW_MS;
    if (startsSession) {
      day.visits += 1;
      const country = visitorCountry(request);
      day.countries[country] = (day.countries[country] || 0) + 1;
    }
    day.visitors[fingerprint] = {
      firstSeen: previous?.firstSeen || nowIso,
      lastSeen: nowIso,
      lastSessionAt: startsSession ? nowIso : previous.lastSessionAt,
      sessions: (previous?.sessions || 0) + (startsSession ? 1 : 0),
    };
    store.days[dayKey] = day;
    store.updatedAt = nowIso;
    await saveStore(store);
  });
};

const visitsSince = (store: AnalyticsStore, firstDay: string) =>
  Object.entries(store.days).reduce(
    (total, [date, day]) => total + (date >= firstDay ? day.visits : 0),
    0,
  );

const dayOffset = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const getAnalyticsSummary = async (): Promise<AnalyticsSummary> => {
  await writeQueue;
  const store = await readStore();
  const todayKey = dayOffset(0);
  const today = store.days[todayKey] || { visits: 0, visitors: {}, countries: {} };
  const countryTotals = new Map<string, number>();
  let retainedVisits = 0;
  for (const day of Object.values(store.days)) {
    retainedVisits += day.visits;
    for (const [country, visits] of Object.entries(day.countries)) {
      countryTotals.set(country, (countryTotals.get(country) || 0) + visits);
    }
  }

  return {
    trackingStartedAt: store.startedAt,
    lastVisitAt: store.updatedAt,
    today: {
      uniqueVisitors: Object.keys(today.visitors).length,
      visits: today.visits,
    },
    last7Visits: visitsSince(store, dayOffset(6)),
    last30Visits: visitsSince(store, dayOffset(29)),
    retainedVisits,
    recentDays: Object.entries(store.days)
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 30)
      .map(([date, day]) => ({
        date,
        uniqueVisitors: Object.keys(day.visitors).length,
        visits: day.visits,
      })),
    topCountries: [...countryTotals.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([country, visits]) => ({ country, visits })),
  };
};

export const analyticsTokenIsValid = (providedToken: string) =>
  configuredToken.length >= 32 &&
  providedToken.length === configuredToken.length &&
  timingSafeEqual(Buffer.from(providedToken), Buffer.from(configuredToken));
