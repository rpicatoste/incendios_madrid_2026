import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_RETRY_MS = 5 * 60 * 1000;

const GRID = {
  south: 39.35,
  north: 42.15,
  west: -5.9,
  east: -1.7,
  rows: 7,
  columns: 9,
} as const;

export type WindField = {
  schemaVersion: 1;
  fetchedAt: string;
  validAt: string;
  expiresAt: string;
  sourceOk: boolean;
  stale?: true;
  grid: typeof GRID;
  vectors: Array<[eastKmh: number, northKmh: number]>;
};

type CacheEntry = {
  schemaVersion: 1;
  expiresAt: number;
  payload: WindField;
};

type OpenMeteoPoint = {
  current?: {
    time?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
};

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const cacheFile = join(dataDirectory, "cache", "wind-field.json");

let memoryCache: CacheEntry | undefined;
let diskCachePromise: Promise<CacheEntry | undefined> | undefined;
let refreshPromise: Promise<WindField> | undefined;
let failedRefreshRetryAt = 0;

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validField = (value: unknown): value is WindField => {
  if (!value || typeof value !== "object") return false;
  const field = value as Partial<WindField>;
  return (
    field.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof field.fetchedAt === "string" &&
    typeof field.validAt === "string" &&
    typeof field.expiresAt === "string" &&
    Number.isFinite(Date.parse(field.fetchedAt)) &&
    Number.isFinite(Date.parse(field.validAt)) &&
    Number.isFinite(Date.parse(field.expiresAt)) &&
    field.sourceOk === true &&
    field.grid?.south === GRID.south &&
    field.grid?.north === GRID.north &&
    field.grid?.west === GRID.west &&
    field.grid?.east === GRID.east &&
    field.grid?.rows === GRID.rows &&
    field.grid?.columns === GRID.columns &&
    Array.isArray(field.vectors) &&
    field.vectors.length === GRID.rows * GRID.columns &&
    field.vectors.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === 2 &&
        finiteNumber(vector[0]) &&
        finiteNumber(vector[1]),
    )
  );
};

const readDiskCache = async () => {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as Partial<CacheEntry>;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      !finiteNumber(parsed.expiresAt) ||
      !validField(parsed.payload) ||
      parsed.expiresAt !== Date.parse(parsed.payload.expiresAt)
    ) {
      return undefined;
    }
    return parsed as CacheEntry;
  } catch {
    return undefined;
  }
};

const getCachedEntry = async () => {
  if (memoryCache) return memoryCache;
  diskCachePromise ||= readDiskCache();
  memoryCache = await diskCachePromise;
  return memoryCache;
};

const writeDiskCache = async (entry: CacheEntry) => {
  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(cacheFile), { recursive: true });
  try {
    await writeFile(temporaryFile, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporaryFile, cacheFile);
    memoryCache = entry;
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
};

const coordinates = Array.from(
  { length: GRID.rows * GRID.columns },
  (_, index) => {
    const row = Math.floor(index / GRID.columns);
    const column = index % GRID.columns;
    return {
      lat:
        GRID.south +
        (row / (GRID.rows - 1)) * (GRID.north - GRID.south),
      lon:
        GRID.west +
        (column / (GRID.columns - 1)) * (GRID.east - GRID.west),
    };
  },
);

const rounded = (value: number) => Math.round(value * 1000) / 1000;

const vectorFromMeteorologicalDirection = (
  speedKmh: number,
  windFromDegrees: number,
): [number, number] => {
  const movementBearing =
    ((((windFromDegrees + 180) % 360) + 360) % 360 * Math.PI) / 180;
  return [
    rounded(speedKmh * Math.sin(movementBearing)),
    rounded(speedKmh * Math.cos(movementBearing)),
  ];
};

const fetchWindField = async () => {
  const params = new URLSearchParams({
    latitude: coordinates.map(({ lat }) => lat.toFixed(4)).join(","),
    longitude: coordinates.map(({ lon }) => lon.toFixed(4)).join(","),
    current: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "kmh",
    timeformat: "unixtime",
  });
  const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "FOCO-Centro/2.0 (+https://github.com/rpicatoste/incendios_madrid_2026)",
    },
  });
  if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
  const payload = (await response.json()) as OpenMeteoPoint[] | OpenMeteoPoint;
  const points = Array.isArray(payload) ? payload : [payload];
  if (points.length !== coordinates.length) {
    throw new Error("Open-Meteo devolvió una malla incompleta");
  }

  const sourceTimes: number[] = [];
  const vectors = points.map((point) => {
    const speed = point.current?.wind_speed_10m;
    const direction = point.current?.wind_direction_10m;
    const sourceTime = point.current?.time;
    if (
      !finiteNumber(speed) ||
      speed < 0 ||
      !finiteNumber(direction) ||
      !finiteNumber(sourceTime)
    ) {
      throw new Error("Open-Meteo devolvió un vector inválido");
    }
    sourceTimes.push(sourceTime);
    return vectorFromMeteorologicalDirection(speed, direction);
  });

  const fetchedAt = new Date();
  const expiresAt = fetchedAt.getTime() + CACHE_TTL_MS;
  const field: WindField = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fetchedAt: fetchedAt.toISOString(),
    validAt: new Date(Math.min(...sourceTimes) * 1000).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    sourceOk: true,
    grid: GRID,
    vectors,
  };
  const entry: CacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    expiresAt,
    payload: field,
  };
  await writeDiskCache(entry);
  return field;
};

const staleField = (cached: CacheEntry): WindField => ({
  ...cached.payload,
  sourceOk: false,
  stale: true,
});

export const getWindField = async () => {
  const cached = await getCachedEntry();
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (failedRefreshRetryAt > Date.now()) {
    if (cached) return staleField(cached);
    throw new Error("Open-Meteo está temporalmente en espera");
  }

  refreshPromise ||= fetchWindField().finally(() => {
    refreshPromise = undefined;
  });
  try {
    const field = await refreshPromise;
    failedRefreshRetryAt = 0;
    return field;
  } catch (error) {
    failedRefreshRetryAt = Date.now() + FAILURE_RETRY_MS;
    if (!cached) throw error;
    return staleField(cached);
  }
};
