import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

export const SATELLITE_BOUNDS: [[number, number], [number, number]] = [
  [39.35, -5.9],
  [42.15, -1.7],
];
export const SATELLITE_LAYERS = ["burnt", "heat", "smoke", "copernicus"] as const;
export type SatelliteLayer = (typeof SATELLITE_LAYERS)[number];
type RasterLayer = Exclude<SatelliteLayer, "copernicus">;

type CopernicusMap = {
  source?: {
    areaProduct?: string;
    areaObservedAt?: string;
    frontProduct?: string;
    frontObservedAt?: string;
    readAt?: string;
  };
};

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
  schemaVersion?: 2 | 3;
  capturedAt: string;
  bounds: typeof SATELLITE_BOUNDS;
  layers: Partial<Record<SatelliteLayer, true>>;
  layerCapturedAt: Partial<Record<SatelliteLayer, string>>;
  layerSourceDate?: Partial<Record<RasterLayer, string>>;
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

const LOOKBACK_DAYS: Record<RasterLayer, number> = {
  burnt: 0,
  heat: 2,
  smoke: 2,
};

const sourceUrl = (layer: RasterLayer, date: string) => {
  const isEffis = layer === "burnt";
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
          ? [
              "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
              "VIIRS_SNPP_Thermal_Anomalies_375m_All",
            ].join(",")
          : "VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate",
    STYLES: layer === "heat" ? "size10,size10" : "",
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

const paethPredictor = (left: number, above: number, upperLeft: number) => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

export const pngHasVisiblePixels = (bytes: Uint8Array) => {
  const dimensions = readPngDimensions(bytes);
  if (!dimensions || bytes.length < 29) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlaced = bytes[28] !== 0;
  if (bitDepth !== 8 || colorType !== 6 || interlaced) return true;

  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const nextOffset = dataStart + length + 4;
    if (nextOffset > bytes.length) return false;
    if (type === "IDAT") idatChunks.push(Buffer.from(bytes.subarray(dataStart, dataStart + length)));
    offset = nextOffset;
    if (type === "IEND") break;
  }
  if (!idatChunks.length) return false;

  const bytesPerPixel = 4;
  const stride = dimensions.width * bytesPerPixel;
  const expectedLength = (stride + 1) * dimensions.height;
  try {
    const inflated = inflateSync(Buffer.concat(idatChunks), {
      maxOutputLength: expectedLength,
    });
    if (inflated.length !== expectedLength) return false;
    let previousRow = new Uint8Array(stride);
    let currentRow = new Uint8Array(stride);
    let cursor = 0;

    for (let row = 0; row < dimensions.height; row += 1) {
      const filter = inflated[cursor];
      cursor += 1;
      for (let column = 0; column < stride; column += 1) {
        const raw = inflated[cursor];
        cursor += 1;
        const left = column >= bytesPerPixel ? currentRow[column - bytesPerPixel] : 0;
        const above = previousRow[column];
        const upperLeft = column >= bytesPerPixel ? previousRow[column - bytesPerPixel] : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? above
                : filter === 3
                  ? Math.floor((left + above) / 2)
                  : filter === 4
                    ? paethPredictor(left, above, upperLeft)
                    : Number.NaN;
        if (!Number.isFinite(predictor)) return false;
        currentRow[column] = (raw + predictor) & 0xff;
      }
      for (let alpha = 3; alpha < stride; alpha += bytesPerPixel) {
        if (currentRow[alpha] !== 0) return true;
      }
      [previousRow, currentRow] = [currentRow, previousRow];
    }
    return false;
  } catch {
    return false;
  }
};

const sourceDates = (date: string, lookbackDays: number) => {
  const start = new Date(`${date}T00:00:00Z`);
  return Array.from({ length: lookbackDays + 1 }, (_, daysAgo) => {
    const candidate = new Date(start);
    candidate.setUTCDate(candidate.getUTCDate() - daysAgo);
    return candidate.toISOString().slice(0, 10);
  });
};

const capturePng = async (
  hourId: string,
  layer: RasterLayer,
  date: string,
) => {
  let lastError = "Sin captura";
  for (const sourceDate of sourceDates(date, LOOKBACK_DAYS[layer])) {
    try {
      const response = await fetch(sourceUrl(layer, sourceDate), {
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
      if (!pngHasVisiblePixels(bytes)) throw new Error("Imagen transparente sin datos");
      await atomicWrite(layerPath(hourId, layer), bytes);
      return { sourceDate };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Sin captura";
    }
  }
  throw new Error(lastError);
};

export const captureSatelliteSnapshot = async (
  storageId: string,
  capturedAt: string,
  copernicusMap: CopernicusMap,
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
  const layerSourceDate: NonNullable<SatelliteSnapshot["layerSourceDate"]> = {};
  const rasterDimensions: NonNullable<SatelliteSnapshot["rasterDimensions"]> = {};
  const staleLayers: NonNullable<SatelliteSnapshot["staleLayers"]> = {};
  const errors: NonNullable<SatelliteSnapshot["errors"]> = {};
  await Promise.all(SATELLITE_LAYERS.map(async (layer, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      layers[layer] = true;
      layerCapturedAt[layer] = capturedAt;
      if (layer !== "copernicus") {
        const sourceDate = (result.value as { sourceDate: string }).sourceDate;
        layerSourceDate[layer] = sourceDate;
        rasterDimensions[layer] = RASTER_DIMENSIONS[layer];
        if (sourceDate !== date) staleLayers[layer] = true;
      }
      return;
    }
    errors[layer] = result.reason instanceof Error ? result.reason.message : "Sin captura";
    if (!previous?.layers[layer]) return;
    try {
      const existingBytes = await readFile(layerPath(storageId, layer));
      if (layer !== "copernicus" && !pngHasVisiblePixels(existingBytes)) return;
      layers[layer] = true;
      staleLayers[layer] = true;
      layerCapturedAt[layer] =
        previous.layerCapturedAt?.[layer] || previous.capturedAt;
      if (layer !== "copernicus") {
        layerSourceDate[layer] =
          previous.layerSourceDate?.[layer] || previous.capturedAt.slice(0, 10);
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
    schemaVersion: 3,
    capturedAt,
    bounds: SATELLITE_BOUNDS,
    layers,
    layerCapturedAt,
    layerSourceDate,
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
