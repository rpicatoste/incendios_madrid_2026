import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

const EFFIS_API_URL =
  "https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current";
const EFFIS_VIEWER_URL =
  "https://forest-fire.emergency.copernicus.eu/apps/effis.csv/";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const LOOKBACK_DAYS = 30;
const VIEW_BOUNDS = [-5.9, 39.35, -1.7, 42.15] as const;

type EffisGeometry = Polygon | MultiPolygon;

type EffisApiArea = {
  id?: unknown;
  bbox?: unknown;
  firedate?: unknown;
  lastfiredate?: unknown;
  lastupdate?: unknown;
  area_ha?: unknown;
  province?: unknown;
  commune?: unknown;
  shape?: unknown;
};

type EffisApiResponse = {
  count?: unknown;
  results?: unknown;
};

export type EffisAreaFeatureProperties = {
  id: number | string;
  fireDate?: string;
  lastFireDate?: string;
  lastUpdate?: string;
  areaHectares?: number;
  province?: string;
  commune?: string;
};

export type EffisAreaMap = FeatureCollection<
  EffisGeometry,
  EffisAreaFeatureProperties
> & {
  source: {
    label: string;
    url: string;
    readAt?: string;
    checkedAt: string;
    periodDays: number;
    stale?: true;
    error?: string;
  };
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

type EffisAreaBundle = {
  schemaVersion: 1;
  status: EffisAreaStatus;
  map: EffisAreaMap;
};

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const cachePath = join(dataDirectory, "cache", "effis-area-bundle.json");
let pendingRefresh: Promise<EffisAreaBundle> | undefined;

const validDate = (value: unknown) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
};

const validText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : undefined;

const validNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

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

const validGeometry = (value: unknown): value is EffisGeometry => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return (
    (candidate.type === "Polygon" || candidate.type === "MultiPolygon") &&
    Array.isArray(candidate.coordinates)
  );
};

const validStatus = (value: unknown): value is EffisAreaStatus => {
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

const validMap = (value: unknown): value is EffisAreaMap => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EffisAreaMap>;
  return (
    candidate.type === "FeatureCollection" &&
    Array.isArray(candidate.features) &&
    candidate.features.every((feature) => validGeometry(feature?.geometry)) &&
    Boolean(candidate.source) &&
    typeof candidate.source?.checkedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.source.checkedAt))
  );
};

const readCache = async () => {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as Partial<EffisAreaBundle>;
    return parsed.schemaVersion === 1 &&
      validStatus(parsed.status) &&
      validMap(parsed.map)
      ? (parsed as EffisAreaBundle)
      : undefined;
  } catch {
    return undefined;
  }
};

const writeCache = async (bundle: EffisAreaBundle) => {
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(bundle), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, cachePath);
};

const areaFeature = (
  area: EffisApiArea,
  index: number,
): EffisAreaMap["features"][number] | undefined => {
  if (!validGeometry(area.shape)) return undefined;
  return {
    type: "Feature",
    geometry: area.shape,
    properties: {
      id:
        typeof area.id === "number" || typeof area.id === "string"
          ? area.id
          : `effis-${index}`,
      fireDate: validDate(area.firedate),
      lastFireDate: validDate(area.lastfiredate),
      lastUpdate: validDate(area.lastupdate),
      areaHectares: validNumber(area.area_ha),
      province: validText(area.province),
      commune: validText(area.commune),
    },
  };
};

const refreshBundle = async (now: Date) => {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
  const url = new URL(EFFIS_API_URL);
  url.searchParams.set("country", "ES");
  url.searchParams.set(
    "lastupdate__gte",
    `${from.toISOString().slice(0, 10)}T00:00:00`,
  );
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
  const checkedAt = now.toISOString();
  const status: EffisAreaStatus = {
    schemaVersion: 1,
    readAt: checkedAt,
    checkedAt,
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
  const map: EffisAreaMap = {
    type: "FeatureCollection",
    source: {
      label: "Copernicus EFFIS · área recorrida",
      url: EFFIS_VIEWER_URL,
      readAt: checkedAt,
      checkedAt,
      periodDays: LOOKBACK_DAYS,
    },
    features: areasInView
      .map(areaFeature)
      .filter((feature): feature is EffisAreaMap["features"][number] =>
        Boolean(feature),
      ),
  };
  const bundle: EffisAreaBundle = { schemaVersion: 1, status, map };
  await writeCache(bundle);
  return bundle;
};

export const getEffisAreaBundle = async (now = new Date()) => {
  const cached = await readCache();
  const cacheAge = cached
    ? now.getTime() - Date.parse(cached.status.checkedAt)
    : Infinity;
  if (cached && cacheAge >= 0 && cacheAge < REFRESH_INTERVAL_MS) return cached;
  if (!pendingRefresh) {
    pendingRefresh = refreshBundle(now).finally(() => {
      pendingRefresh = undefined;
    });
  }
  try {
    return await pendingRefresh;
  } catch (error) {
    const checkedAt = now.toISOString();
    const message = error instanceof Error ? error.message : "EFFIS no accesible";
    const failedBundle: EffisAreaBundle = cached
      ? {
          schemaVersion: 1,
          status: {
            ...cached.status,
            checkedAt,
            stale: true,
            error: message,
          },
          map: {
            ...cached.map,
            source: {
              ...cached.map.source,
              checkedAt,
              stale: true,
              error: message,
            },
          },
        }
      : {
          schemaVersion: 1,
          status: {
            schemaVersion: 1,
            checkedAt,
            periodDays: LOOKBACK_DAYS,
            recentAreasInSpain: 0,
            recentAreasInView: 0,
            stale: true,
            error: message,
          },
          map: {
            type: "FeatureCollection",
            source: {
              label: "Copernicus EFFIS · área recorrida",
              url: EFFIS_VIEWER_URL,
              checkedAt,
              periodDays: LOOKBACK_DAYS,
              stale: true,
              error: message,
            },
            features: [],
          },
        };
    await writeCache(failedBundle);
    return failedBundle;
  }
};

export const getEffisAreaStatus = async (now = new Date()) =>
  (await getEffisAreaBundle(now)).status;
