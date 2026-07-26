import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const EFFIS_API_URL =
  "https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const LOOKBACK_DAYS = 30;
const VIEW_BOUNDS = [-5.9, 39.35, -1.7, 42.15] as const;

type EffisApiArea = {
  bbox?: unknown;
  lastupdate?: unknown;
};

type EffisApiResponse = {
  count?: unknown;
  results?: unknown;
};

export type EffisAreaStatus = {
  schemaVersion: 1;
  checkedAt: string;
  readAt?: string;
  periodDays: number;
  recentAreasInSpain: number;
  recentAreasInView: number;
  latestUpdateSpain?: string;
  latestUpdateInView?: string;
  stale?: true;
  error?: string;
};

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const cachePath = join(dataDirectory, "cache", "effis-area-status.json");
let pendingRefresh: Promise<EffisAreaStatus> | undefined;

const validDate = (value: unknown) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
};

const latestDate = (values: Array<string | undefined>) =>
  values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

const intersectsView = (bbox: unknown) => {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    return false;
  }
  const [west, south, east, north] = bbox as [number, number, number, number];
  return (
    east >= VIEW_BOUNDS[0] &&
    west <= VIEW_BOUNDS[2] &&
    north >= VIEW_BOUNDS[1] &&
    south <= VIEW_BOUNDS[3]
  );
};

const validCache = (value: unknown): value is EffisAreaStatus => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EffisAreaStatus>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.checkedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.checkedAt)) &&
    (candidate.readAt === undefined ||
      !Number.isNaN(Date.parse(candidate.readAt))) &&
    candidate.periodDays === LOOKBACK_DAYS &&
    typeof candidate.recentAreasInSpain === "number" &&
    typeof candidate.recentAreasInView === "number"
  );
};

const readCache = async () => {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
    return validCache(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeCache = async (status: EffisAreaStatus) => {
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(status), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, cachePath);
};

const refreshStatus = async (now: Date) => {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
  const url = new URL(EFFIS_API_URL);
  url.searchParams.set("country", "ES");
  url.searchParams.set("lastupdate__gte", `${from.toISOString().slice(0, 10)}T00:00:00`);
  url.searchParams.set("ordering", "-lastupdate,-area_ha");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      "User-Agent": "FOCO-Centro/2.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as EffisApiResponse;
  if (!Array.isArray(payload.results)) {
    throw new Error("La API de EFFIS no devolvió una lista");
  }

  const areas = payload.results as EffisApiArea[];
  const areasInView = areas.filter((area) => intersectsView(area.bbox));
  const status: EffisAreaStatus = {
    schemaVersion: 1,
    readAt: now.toISOString(),
    checkedAt: now.toISOString(),
    periodDays: LOOKBACK_DAYS,
    recentAreasInSpain:
      typeof payload.count === "number" && Number.isFinite(payload.count)
        ? payload.count
        : areas.length,
    recentAreasInView: areasInView.length,
    latestUpdateSpain: latestDate(areas.map((area) => validDate(area.lastupdate))),
    latestUpdateInView: latestDate(
      areasInView.map((area) => validDate(area.lastupdate)),
    ),
  };
  await writeCache(status);
  return status;
};

export const getEffisAreaStatus = async (now = new Date()) => {
  const cached = await readCache();
  const cacheAge = cached ? now.getTime() - Date.parse(cached.checkedAt) : Infinity;
  if (cached && cacheAge >= 0 && cacheAge < REFRESH_INTERVAL_MS) return cached;
  if (!pendingRefresh) {
    pendingRefresh = refreshStatus(now).finally(() => {
      pendingRefresh = undefined;
    });
  }
  try {
    return await pendingRefresh;
  } catch (error) {
    const failedStatus: EffisAreaStatus = {
      ...(cached || {
        schemaVersion: 1 as const,
        periodDays: LOOKBACK_DAYS,
        recentAreasInSpain: 0,
        recentAreasInView: 0,
      }),
      checkedAt: now.toISOString(),
      stale: true as const,
      error: error instanceof Error ? error.message : "EFFIS no accesible",
    };
    await writeCache(failedStatus);
    return failedStatus;
  }
};
