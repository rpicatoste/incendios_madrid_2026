import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SATELLITE_BOUNDS: [[number, number], [number, number]] = [
  [39.35, -5.9],
  [42.15, -1.7],
];
export const SATELLITE_LAYERS = ["burnt", "heat", "smoke", "copernicus"] as const;
export type SatelliteLayer = (typeof SATELLITE_LAYERS)[number];
type RasterLayer = Exclude<SatelliteLayer, "copernicus">;

const RASTER_DIMENSIONS: Record<RasterLayer, { width: number; height: number }> = {
  // El área quemada necesita conservar el contorno al ampliar. 4096 px equivale
  // aproximadamente a cuatro veces el detalle horizontal de la antigua copia.
  burnt: { width: 4096, height: 2731 },
  // El WMS de hotspots devuelve HTTP 500 por encima de su tamaño operativo.
  heat: { width: 1600, height: 1067 },
  // El producto de aerosoles tiene una resolución nativa bastante menor.
  smoke: { width: 1600, height: 1067 },
};

export type SatelliteSnapshot = {
  schemaVersion?: 2;
  capturedAt: string;
  bounds: typeof SATELLITE_BOUNDS;
  layers: Partial<Record<SatelliteLayer, true>>;
  layerCapturedAt: Partial<Record<SatelliteLayer, string>>;
  rasterDimensions?: Partial<
    Record<RasterLayer, { width: number; height: number }>
  >;
  staleLayers?: Partial<Record<SatelliteLayer, true>>;
  errors?: Partial<Record<SatelliteLayer, string>>;
  copernicus?: {
    areaProduct?: string;
    areaObservedAt?: string;
    frontProduct?: string;
    frontObservedAt?: string;
    readAt?: string;
  };
};

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const satelliteDirectory = join(dataDirectory, "satellite");

const layerPath = (hourId: string, layer: SatelliteLayer) =>
  join(satelliteDirectory, hourId, `${layer}.${layer === "copernicus" ? "json" : "png"}`);
const manifestPath = (storageId: string) =>
  join(satelliteDirectory, storageId, "manifest.json");

const sourceUrl = (layer: RasterLayer, date: string) => {
  const isEffis = layer !== "smoke";
  const dimensions = RASTER_DIMENSIONS[layer];
  const url = new URL(
    isEffis
      ? "https://maps.effis.emergency.copernicus.eu/effis"
      : "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
  );
  const params = {
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS:
      layer === "burnt"
        ? "effis.nrt.ba.poly"
        : layer === "heat"
          ? "viirs.hs"
          : "VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate",
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: "EPSG:4326",
    BBOX: "-5.9,39.35,-1.7,42.15",
    WIDTH: String(dimensions.width),
    HEIGHT: String(dimensions.height),
    TIME: date,
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

const atomicWrite = async (path: string, contents: Uint8Array | string) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
};

const readPngDimensions = (bytes: Uint8Array) => {
  if (bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
};

const capturePng = async (
  hourId: string,
  layer: RasterLayer,
  date: string,
) => {
  const response = await fetch(sourceUrl(layer, date), {
    signal: AbortSignal.timeout(45000),
    headers: {
      "User-Agent": "FOCO-Centro/2.0",
      Accept: "image/png",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error("La fuente no devolvió PNG");
  }
  if (bytes.length > 24 * 1024 * 1024) throw new Error("Imagen demasiado grande");
  await atomicWrite(layerPath(hourId, layer), bytes);
};

export const captureSatelliteSnapshot = async (
  storageId: string,
  capturedAt: string,
  copernicusMap: any,
): Promise<SatelliteSnapshot> => {
  const date = capturedAt.slice(0, 10);
  let previous: SatelliteSnapshot | undefined;
  try {
    previous = JSON.parse(
      await readFile(manifestPath(storageId), "utf8"),
    ) as SatelliteSnapshot;
  } catch {
    previous = undefined;
  }
  const results = await Promise.allSettled([
    capturePng(storageId, "burnt", date),
    capturePng(storageId, "heat", date),
    capturePng(storageId, "smoke", date),
    atomicWrite(layerPath(storageId, "copernicus"), JSON.stringify(copernicusMap)),
  ]);
  const layers: SatelliteSnapshot["layers"] = {};
  const layerCapturedAt: SatelliteSnapshot["layerCapturedAt"] = {};
  const rasterDimensions: NonNullable<SatelliteSnapshot["rasterDimensions"]> = {};
  const staleLayers: NonNullable<SatelliteSnapshot["staleLayers"]> = {};
  const errors: NonNullable<SatelliteSnapshot["errors"]> = {};
  await Promise.all(SATELLITE_LAYERS.map(async (layer, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      layers[layer] = true;
      layerCapturedAt[layer] = capturedAt;
      if (layer !== "copernicus") rasterDimensions[layer] = RASTER_DIMENSIONS[layer];
      return;
    }
    errors[layer] = result.reason instanceof Error ? result.reason.message : "Sin captura";
    if (!previous?.layers[layer]) return;
    try {
      const existingBytes = await readFile(layerPath(storageId, layer));
      layers[layer] = true;
      staleLayers[layer] = true;
      layerCapturedAt[layer] =
        previous.layerCapturedAt?.[layer] || previous.capturedAt;
      if (layer !== "copernicus") {
        rasterDimensions[layer] =
          readPngDimensions(existingBytes) ||
          previous.rasterDimensions?.[layer] ||
          RASTER_DIMENSIONS[layer];
      }
    } catch {
      // No existe una copia anterior válida que se pueda conservar.
    }
  }));
  const snapshot: SatelliteSnapshot = {
    schemaVersion: 2,
    capturedAt,
    bounds: SATELLITE_BOUNDS,
    layers,
    layerCapturedAt,
    rasterDimensions,
    ...(Object.keys(staleLayers).length ? { staleLayers } : {}),
    ...(Object.keys(errors).length ? { errors } : {}),
    copernicus: copernicusMap?.source
      ? {
          areaProduct: copernicusMap.source.areaProduct,
          areaObservedAt: copernicusMap.source.areaObservedAt,
          frontProduct: copernicusMap.source.frontProduct,
          frontObservedAt: copernicusMap.source.frontObservedAt,
          readAt: copernicusMap.source.readAt,
        }
      : undefined,
  };
  await atomicWrite(manifestPath(storageId), JSON.stringify(snapshot));
  return snapshot;
};

export const readSatelliteLayer = (hourId: string, layer: SatelliteLayer) =>
  readFile(layerPath(hourId, layer));

export const readSatelliteManifest = (storageId: string) =>
  readFile(manifestPath(storageId));

export const freezeSatelliteSnapshot = async (
  sourceId: string,
  hourId: string,
  snapshot: SatelliteSnapshot,
) => {
  await mkdir(join(satelliteDirectory, hourId), { recursive: true });
  await Promise.all(
    SATELLITE_LAYERS.filter((layer) => snapshot.layers[layer]).map((layer) =>
      copyFile(layerPath(sourceId, layer), layerPath(hourId, layer)),
    ),
  );
  await atomicWrite(manifestPath(hourId), JSON.stringify(snapshot));
  return snapshot;
};
