import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ICA_URL = "https://ica.miteco.es/datos/ica-ultima-hora.csv";
const CACHE_TTL_MS = 15 * 60 * 1000;
const LOCK_STALE_MS = 30 * 1000;
const LOCK_WAIT_MS = 12 * 1000;
const dataDirectory = process.env.FOCO_DATA_DIR || join(process.cwd(), "data");
const cacheFile = join(dataDirectory, "cache", "air-quality.json");
const lockDirectory = join(dataDirectory, "cache", ".air-quality.lock");
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
};
const ERROR_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

type CacheEntry = {
  expiresAt: number;
  payload: Record<string, unknown>;
};

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";

const readDiskCache = async (): Promise<CacheEntry | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as Partial<CacheEntry>;
    if (
      typeof parsed.expiresAt !== "number" ||
      !parsed.payload ||
      !Array.isArray(parsed.payload.stations)
    ) {
      return undefined;
    }
    return parsed as CacheEntry;
  } catch {
    return undefined;
  }
};

const writeDiskCache = async (cache: CacheEntry) => {
  await mkdir(dirname(cacheFile), { recursive: true });
  const temporaryFile =
    cacheFile + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    await writeFile(temporaryFile, JSON.stringify(cache), { mode: 0o600 });
    await rename(temporaryFile, cacheFile);
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
};

const acquireRefreshLock = async () => {
  await mkdir(dirname(lockDirectory), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDirectory);
      return true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      try {
        const lock = await stat(lockDirectory);
        if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lockDirectory);
          continue;
        }
      } catch (lockError) {
        if (errorCode(lockError) === "ENOENT") continue;
      }
      return false;
    }
  }
  return false;
};

const releaseRefreshLock = async () => {
  await rmdir(lockDirectory).catch(() => {});
};

const waitForFreshCache = async () => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const cache = await readDiskCache();
    if (cache && cache.expiresAt > Date.now()) return cache;
  }
  return undefined;
};
const quality = [
  { label: "sin dato", color: "#7f8c90" },
  { label: "buena", color: "#45d49a" },
  { label: "razonablemente buena", color: "#a7d66d" },
  { label: "regular", color: "#ffd45a" },
  { label: "desfavorable", color: "#ff994f" },
  { label: "muy desfavorable", color: "#ef586f" },
  { label: "extremadamente desfavorable", color: "#9c5cc8" },
];

const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
};

const parseObservedAt = (value: string) => new Date(value + "Z");

const formatObservedAt = (value: string) => {
  const observedAt = parseObservedAt(value);
  if (Number.isNaN(observedAt.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(observedAt);
  return formatted.replace(",", " ·") + " h peninsular";
};

const responseFromCache = (cache: CacheEntry, stale = false) =>
  Response.json(
    stale ? { ...cache.payload, sourceOk: false, stale: true } : cache.payload,
    { headers: stale ? ERROR_CACHE_HEADERS : CACHE_HEADERS },
  );

const unavailableResponse = () =>
  Response.json(
    {
      stations: [],
      fetchedAt: new Date().toISOString(),
      source: ICA_URL,
      sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
      sourceOk: false,
      stale: true,
    },
    { status: 200, headers: ERROR_CACHE_HEADERS },
  );

export async function GET() {
  let cached = await readDiskCache();
  if (cached && cached.expiresAt > Date.now()) return responseFromCache(cached);

  const ownsRefreshLock = await acquireRefreshLock();
  if (!ownsRefreshLock) {
    const refreshed = await waitForFreshCache();
    if (refreshed) return responseFromCache(refreshed);
    cached = (await readDiskCache()) || cached;
    return cached ? responseFromCache(cached, true) : unavailableResponse();
  }

  try {
    const refreshed = await readDiskCache();
    if (refreshed && refreshed.expiresAt > Date.now()) {
      return responseFromCache(refreshed);
    }
    cached = refreshed || cached;

    try {
      const response = await fetch(ICA_URL, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "FOCO-Centro/2.0" },
      });
      if (!response.ok) throw new Error("National air quality feed unavailable");
      const csv = await response.text();
      const rows = csv.trim().split(/\r?\n/).slice(1);
      const stations = rows
        .map((line) => {
          const [code, name, type, latRaw, lonRaw, activeRaw, observedAt, rawIndex, pollutant] =
            parseCsvLine(line);
          const lat = Number(latRaw);
          const lon = Number(lonRaw);
          const suppliedIndex = Number(rawIndex);
          const index = suppliedIndex >= 10 ? Math.floor(suppliedIndex / 10) : suppliedIndex;
          const status = quality[index] || quality[0];
          return {
            id: Number(code),
            name,
            type,
            lat,
            lon,
            active: activeRaw === "true",
            label: status.label,
            color: status.color,
            pollutant: pollutant || null,
            value: null,
            index,
            incomplete: suppliedIndex >= 10,
            hour: observedAt ? formatObservedAt(observedAt) : null,
            observedAt: observedAt ? `${observedAt}Z` : null,
            delayed: observedAt
              ? Date.now() - parseObservedAt(observedAt).getTime() > 3 * 60 * 60 * 1000
              : true,
          };
        })
        .filter(
          (station) =>
            station.active &&
            Number.isFinite(station.lat) &&
            Number.isFinite(station.lon) &&
            station.lat >= 39.35 &&
            station.lat <= 42.15 &&
            station.lon >= -5.9 &&
            station.lon <= -1.7,
        );
      if (!stations.length) throw new Error("National air quality feed returned no stations");

      const payload = {
        stations,
        fetchedAt: new Date().toISOString(),
        source: ICA_URL,
        sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
        sourceOk: true,
        stale: false,
      };
      const cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
      await writeDiskCache(cache).catch(() => {});
      return Response.json(payload, { headers: CACHE_HEADERS });
    } catch {
      return cached ? responseFromCache(cached, true) : unavailableResponse();
    }
  } finally {
    await releaseRefreshLock();
  }
}
