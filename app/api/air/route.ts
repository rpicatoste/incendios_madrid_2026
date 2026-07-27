import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ICA_URL = "https://ica.miteco.es/datos/ica-ultima-hora.csv";
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 3;
const LAST_VALID_SCHEMA_VERSION = 2;
const MIN_CURRENT_COVERAGE = 0.5;
const LOCK_STALE_MS = 30 * 1000;
const LOCK_WAIT_MS = 12 * 1000;
const dataDirectory = process.env.FOCO_DATA_DIR || join(process.cwd(), "data");
const cacheFile = join(dataDirectory, "cache", "air-quality.json");
const lastValidFile = join(dataDirectory, "cache", "air-quality-last-valid.json");
const snapshotsFile = join(dataDirectory, "snapshots.json");
const lockDirectory = join(dataDirectory, "cache", ".air-quality.lock");
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
};
const ERROR_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

type AirStation = {
  id: number;
  name: string;
  type: string;
  lat: number;
  lon: number;
  active: boolean;
  label: string;
  color: string;
  pollutant: string | null;
  value: null;
  index: number;
  incomplete: boolean;
  hour: string | null;
  observedAt: string | null;
  delayed: boolean;
  upstreamMissing?: boolean;
  carriedForward?: boolean;
};

type CacheEntry = {
  schemaVersion: number;
  expiresAt: number;
  payload: Record<string, unknown>;
};

type LastValidEntry = {
  schemaVersion: number;
  updatedAt: string;
  stations: AirStation[];
};

type SnapshotRecord = {
  data?: {
    airStations?: AirStation[];
  };
};

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";

const readDiskCache = async (): Promise<CacheEntry | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as Partial<CacheEntry>;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
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

const writeLastValidStations = async (stations: AirStation[]) => {
  await mkdir(dirname(lastValidFile), { recursive: true });
  const temporaryFile =
    lastValidFile + "." + process.pid + "." + Date.now() + ".tmp";
  const entry: LastValidEntry = {
    schemaVersion: LAST_VALID_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    stations,
  };
  try {
    await writeFile(temporaryFile, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporaryFile, lastValidFile);
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
};

const readLastValidStations = async (): Promise<AirStation[]> => {
  try {
    const parsed = JSON.parse(
      await readFile(lastValidFile, "utf8"),
    ) as Partial<LastValidEntry>;
    if (
      parsed.schemaVersion !== LAST_VALID_SCHEMA_VERSION ||
      !Array.isArray(parsed.stations)
    ) {
      return [];
    }
    return parsed.stations;
  } catch {
    return [];
  }
};

const readSnapshotFallbackStations = async (): Promise<AirStation[]> => {
  try {
    const snapshots = JSON.parse(
      await readFile(snapshotsFile, "utf8"),
    ) as SnapshotRecord[];
    if (!Array.isArray(snapshots)) return [];
    return snapshots.flatMap((snapshot) =>
      Array.isArray(snapshot.data?.airStations)
        ? snapshot.data.airStations
        : [],
    );
  } catch {
    return [];
  }
};

const observedTime = (station: AirStation) =>
  station.observedAt ? Date.parse(station.observedAt) : Number.NaN;

const isValidStationReading = (station: AirStation) =>
  Number.isInteger(station.index) &&
  station.index >= 1 &&
  station.index <= 6 &&
  Number.isFinite(observedTime(station));

const readFallbackStations = async () => {
  const candidates = (
    await Promise.all([
      readLastValidStations(),
      readSnapshotFallbackStations(),
    ])
  ).flat();
  const latest = new Map<number, AirStation>();
  for (const station of candidates) {
    if (!isValidStationReading(station)) continue;
    const timestamp = observedTime(station);
    const previous = latest.get(station.id);
    if (!previous || timestamp > observedTime(previous)) {
      latest.set(station.id, station);
    }
  }
  return latest;
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

const observationIsDelayed = (value: string | null) => {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) ||
    Date.now() - timestamp > 3 * 60 * 60 * 1000;
};

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

const unavailableResponse = async () => {
  const fallbackStations = await readFallbackStations();
  const stations = [...fallbackStations.values()].map((station) => ({
    ...station,
    delayed: true,
    upstreamMissing: true,
    carriedForward: true,
  }));
  const payload = {
    stations,
    fetchedAt: new Date().toISOString(),
    source: ICA_URL,
    sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
    sourceOk: false,
    stale: true,
    degraded: true,
    coverage: {
      total: stations.length,
      reported: 0,
      carriedForward: stations.length,
      noData: 0,
    },
  };
  const cache: CacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    expiresAt: Date.now() + 5 * 60 * 1000,
    payload,
  };
  await writeDiskCache(cache).catch(() => {});
  return Response.json(payload, { status: 200, headers: ERROR_CACHE_HEADERS });
};

const refreshAirCache = async (): Promise<CacheEntry> => {
  const response = await fetch(ICA_URL, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!response.ok) throw new Error("National air quality feed unavailable");
  const csv = await response.text();
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const stations = rows
    .map((line): AirStation => {
      const [code, name, type, latRaw, lonRaw, activeRaw, observedAt, rawIndex, pollutant] =
        parseCsvLine(line);
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      const suppliedIndex = Number(rawIndex);
      const normalizedIndex =
        suppliedIndex >= 10 ? Math.floor(suppliedIndex / 10) : suppliedIndex;
      const hasValidIndex =
        rawIndex.trim() !== "" &&
        Number.isInteger(normalizedIndex) &&
        normalizedIndex >= 1 &&
        normalizedIndex <= 6;
      const index = hasValidIndex ? normalizedIndex : 0;
      const status = quality[index] || quality[0];
      const observation = hasValidIndex && observedAt ? observedAt + "Z" : null;
      return {
        id: Number(code),
        name,
        type,
        lat,
        lon,
        active: activeRaw === "true",
        label: status.label,
        color: status.color,
        pollutant: hasValidIndex && pollutant ? pollutant : null,
        value: null,
        index,
        incomplete: hasValidIndex && suppliedIndex >= 10,
        hour: observation ? formatObservedAt(observedAt) : null,
        observedAt: observation,
        delayed: observationIsDelayed(observation),
        upstreamMissing: !hasValidIndex,
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

  const fallbackStations = await readFallbackStations();
  for (const station of stations) {
    if (!isValidStationReading(station)) continue;
    const previous = fallbackStations.get(station.id);
    if (!previous || observedTime(station) > observedTime(previous)) {
      fallbackStations.set(station.id, station);
    }
  }

  const currentStationIds = new Set(stations.map((station) => station.id));
  const mergedStations = stations.map((station) => {
    if (isValidStationReading(station)) return station;
    const fallback = fallbackStations.get(station.id);
    if (!fallback) return station;
    return {
      ...station,
      label: fallback.label,
      color: fallback.color,
      pollutant: fallback.pollutant,
      index: fallback.index,
      incomplete: fallback.incomplete,
      hour: fallback.hour,
      observedAt: fallback.observedAt,
      delayed: true,
      upstreamMissing: true,
      carriedForward: true,
    };
  });
  for (const fallback of fallbackStations.values()) {
    if (
      currentStationIds.has(fallback.id) ||
      !fallback.active ||
      fallback.lat < 39.35 ||
      fallback.lat > 42.15 ||
      fallback.lon < -5.9 ||
      fallback.lon > -1.7
    ) {
      continue;
    }
    mergedStations.push({
      ...fallback,
      delayed: true,
      upstreamMissing: true,
      carriedForward: true,
    });
  }
  await writeLastValidStations([...fallbackStations.values()]).catch(() => {});

  const reportedStations = stations.filter(isValidStationReading).length;
  const carriedForwardStations = mergedStations.filter(
    (station) => station.carriedForward,
  ).length;
  const noDataStations =
    mergedStations.length - reportedStations - carriedForwardStations;
  const degraded = reportedStations / mergedStations.length < MIN_CURRENT_COVERAGE;
  const payload = {
    stations: mergedStations,
    fetchedAt: new Date().toISOString(),
    source: ICA_URL,
    sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
    sourceOk: true,
    stale: false,
    degraded,
    coverage: {
      total: mergedStations.length,
      reported: reportedStations,
      carriedForward: carriedForwardStations,
      noData: noDataStations,
    },
  };
  const cache: CacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  };
  await writeDiskCache(cache);
  return cache;
};

export async function GET() {
  let cached = await readDiskCache();
  if (cached && cached.expiresAt > Date.now()) return responseFromCache(cached);

  if (cached) {
    const ownsRefreshLock = await acquireRefreshLock();
    if (ownsRefreshLock) {
      void refreshAirCache()
        .catch(() => {})
        .finally(releaseRefreshLock);
    }
    return responseFromCache(cached, true);
  }

  const ownsRefreshLock = await acquireRefreshLock();
  if (!ownsRefreshLock) {
    const refreshed = await waitForFreshCache();
    return refreshed ? responseFromCache(refreshed) : unavailableResponse();
  }

  try {
    cached = await readDiskCache();
    if (cached && cached.expiresAt > Date.now()) return responseFromCache(cached);
    const refreshed = await refreshAirCache();
    return responseFromCache(refreshed);
  } catch {
    return unavailableResponse();
  } finally {
    await releaseRefreshLock();
  }
}
