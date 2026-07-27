import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultRegionData,
  type RegionData,
  type SituationPoint,
  type StatusKind,
} from "./region-data";
import {
  getMadridStatus,
  MADRID_STATUS_SOURCE,
  type MadridStatus,
} from "./madrid-status";

type Coordinates = { lat: number; lon: number };
type GeocodeCache = Record<string, Coordinates>;

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const geocodeFile = join(dataDirectory, "geocodes.json");
const liveRegionCacheFile = join(dataDirectory, "cache", "live-region.json");
const LIVE_REGION_CACHE_SCHEMA_VERSION = 1;
const LIVE_REGION_CACHE_TTL_MS = 5 * 60 * 1000;

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const slugName = (value: string) => normalizeName(value).replaceAll(" ", "-");

const knownCoordinates: GeocodeCache = Object.fromEntries([
  ...defaultRegionData.points
    .filter((point) => point.province === "Madrid")
    .map((point) => [normalizeName(point.name), { lat: point.lat, lon: point.lon }] as const),
  [normalizeName("Alcalá de Henares"), { lat: 40.48198, lon: -3.36354 }],
  [normalizeName("Getafe"), { lat: 40.30825, lon: -3.73239 }],
  [normalizeName("Alcobendas"), { lat: 40.54746, lon: -3.64197 }],
  [normalizeName("Navalcarnero"), { lat: 40.28907, lon: -4.01271 }],
  [normalizeName("Peralejo"), { lat: 40.5398178, lon: -4.1250641 }],
  [normalizeName("Valdemaqueda"), { lat: 40.5110297, lon: -4.2977731 }],
  [normalizeName("Villa del Prado"), { lat: 40.276496, lon: -4.305911 }],
]);

let cachePromise: Promise<GeocodeCache> | undefined;
let geocodeQueue: Promise<unknown> = Promise.resolve();
let lastNominatimRequest = 0;

const readGeocodeCache = async (): Promise<GeocodeCache> => {
  try {
    return JSON.parse(await readFile(geocodeFile, "utf8")) as GeocodeCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

const getGeocodeCache = () => {
  cachePromise ||= readGeocodeCache();
  return cachePromise;
};

const saveGeocodeCache = async (cache: GeocodeCache) => {
  await mkdir(dirname(geocodeFile), { recursive: true });
  const temporaryFile = `${geocodeFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(cache), "utf8");
  await rename(temporaryFile, geocodeFile);
};

const geocodeMadridLocation = async (name: string): Promise<Coordinates | null> => {
  const key = normalizeName(name);
  if (knownCoordinates[key]) return knownCoordinates[key];
  const cache = await getGeocodeCache();
  if (cache[key]) return cache[key];
  if (name.length < 2 || name.length > 120) return null;

  const operation = geocodeQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequest));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimRequest = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "es");
    url.searchParams.set("q", `${name}, Comunidad de Madrid, España`);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent":
          "FOCO-Centro/2.0 (+https://github.com/rpicatoste/incendios_madrid_2026)",
      },
    });
    if (!response.ok) return null;
    const results = (await response.json()) as { lat?: string; lon?: string }[];
    const lat = Number(results[0]?.lat);
    const lon = Number(results[0]?.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < 39.35 ||
      lat > 42.15 ||
      lon < -5.9 ||
      lon > -1.7
    ) {
      return null;
    }
    const coordinates = { lat, lon };
    cache[key] = coordinates;
    await saveGeocodeCache(cache);
    return coordinates;
  });
  geocodeQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

const dynamicPoint = async (
  name: string,
  kind: StatusKind,
  status: MadridStatus,
): Promise<SituationPoint | null> => {
  const coordinates = await geocodeMadridLocation(name);
  if (!coordinates) return null;
  const detail =
    kind === "evacuado"
      ? "Localidad incluida en la relación oficial vigente de evacuaciones."
      : kind === "confinado"
        ? "Localidad incluida en la relación oficial vigente de confinamientos."
        : "Punto de acogida incluido en la relación oficial vigente.";
  return {
    id: `madrid-${kind}-${slugName(name)}`,
    name,
    province: "Madrid",
    kind,
    ...coordinates,
    detail,
    source: MADRID_STATUS_SOURCE,
    sourceLabel: "Comunidad de Madrid",
    sourceUpdatedAt: status.lastUpdated,
  };
};

const buildPoints = async (
  names: string[],
  kind: StatusKind,
  status: MadridStatus,
) => {
  const points: SituationPoint[] = [];
  const unmapped: string[] = [];
  for (const name of names.slice(0, 64)) {
    try {
      const point = await dynamicPoint(name, kind, status);
      if (point) points.push(point);
      else unmapped.push(name);
    } catch {
      unmapped.push(name);
    }
  }
  return { points, unmapped };
};

export const buildLiveRegion = async (status: MadridStatus): Promise<RegionData> => {
  const dynamicKinds = new Set<StatusKind>();
  if (status.authoritative.evacuated) dynamicKinds.add("evacuado");
  if (status.authoritative.confined) dynamicKinds.add("confinado");
  if (status.authoritative.shelters) dynamicKinds.add("acogida");
  const preservedPoints = defaultRegionData.points.filter(
    (point) => point.province !== "Madrid" || !dynamicKinds.has(point.kind),
  );

  const results = await Promise.all([
    status.authoritative.evacuated
      ? buildPoints(status.evacuated, "evacuado", status)
      : Promise.resolve({ points: [], unmapped: [] }),
    status.authoritative.confined
      ? buildPoints(status.confined, "confinado", status)
      : Promise.resolve({ points: [], unmapped: [] }),
    status.authoritative.shelters
      ? buildPoints(status.shelters, "acogida", status)
      : Promise.resolve({ points: [], unmapped: [] }),
  ]);
  const unmappedLocations = results.flatMap((result) => result.unmapped);

  return {
    updatedAt: status.sourceOk
      ? `${status.lastUpdated} · Comunidad de Madrid`
      : `${defaultRegionData.updatedAt} · fuente de Madrid temporalmente no disponible`,
    points: [...preservedPoints, ...results.flatMap((result) => result.points)],
    fires: defaultRegionData.fires,
    ...(unmappedLocations.length ? { unmappedLocations } : {}),
  };
};


type LiveRegionPayload = RegionData & { fetchedAt: string };
type LiveRegionCacheEntry = {
  schemaVersion: number;
  expiresAt: number;
  payload: LiveRegionPayload;
};

let liveRegionMemoryCache: LiveRegionCacheEntry | undefined;
let liveRegionDiskCachePromise: Promise<LiveRegionCacheEntry | undefined> | undefined;
let liveRegionRefreshPromise: Promise<LiveRegionPayload> | undefined;

const readLiveRegionCache = async () => {
  try {
    const parsed = JSON.parse(
      await readFile(liveRegionCacheFile, "utf8"),
    ) as Partial<LiveRegionCacheEntry>;
    if (
      parsed.schemaVersion !== LIVE_REGION_CACHE_SCHEMA_VERSION ||
      typeof parsed.expiresAt !== "number" ||
      !parsed.payload ||
      !Array.isArray(parsed.payload.points) ||
      !Array.isArray(parsed.payload.fires)
    ) {
      return undefined;
    }
    return parsed as LiveRegionCacheEntry;
  } catch {
    return undefined;
  }
};

const getLiveRegionCache = async () => {
  if (liveRegionMemoryCache) return liveRegionMemoryCache;
  liveRegionDiskCachePromise ||= readLiveRegionCache();
  liveRegionMemoryCache = await liveRegionDiskCachePromise;
  return liveRegionMemoryCache;
};

const writeLiveRegionCache = async (cache: LiveRegionCacheEntry) => {
  const temporaryFile = `${liveRegionCacheFile}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(liveRegionCacheFile), { recursive: true });
  try {
    await writeFile(temporaryFile, JSON.stringify(cache), { mode: 0o600 });
    await rename(temporaryFile, liveRegionCacheFile);
    liveRegionMemoryCache = cache;
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
};

const refreshLiveRegion = () => {
  liveRegionRefreshPromise ||= (async () => {
    const status = await getMadridStatus();
    const payload: LiveRegionPayload = {
      ...(await buildLiveRegion(status)),
      fetchedAt: new Date().toISOString(),
    };
    const cache: LiveRegionCacheEntry = {
      schemaVersion: LIVE_REGION_CACHE_SCHEMA_VERSION,
      expiresAt: Date.now() + LIVE_REGION_CACHE_TTL_MS,
      payload,
    };
    await writeLiveRegionCache(cache);
    return payload;
  })().finally(() => {
    liveRegionRefreshPromise = undefined;
  });
  return liveRegionRefreshPromise;
};

export const getLiveRegion = async () => {
  const cached = await getLiveRegionCache();
  if (cached?.expiresAt && cached.expiresAt > Date.now()) return cached.payload;
  const refresh = refreshLiveRegion();
  if (cached) {
    void refresh.catch(() => {});
    return cached.payload;
  }
  return refresh;
};
