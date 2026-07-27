import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FeatureCollection, MultiLineString, MultiPoint, MultiPolygon } from "geojson";

const ACTIVATION_CODES = ["EMSR900", "EMSR898"] as const;
const API_ROOT =
  "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/";
const DATA_HOST = "rapidmapping-viewer.s3.eu-west-1.amazonaws.com";
const DISPLAY_GEOMETRY_VERSION = 2;
const TOLERANCE = 0.001;
const MIN_EXTERIOR_AREA_DEGREES = 0.00002;
const MIN_HOLE_AREA_DEGREES = 0.0005;
const METADATA_TTL_MS = 15 * 60 * 1000;
const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const originalGeometryDirectory = join(
  dataDirectory,
  "cache",
  "copernicus-original",
);

type Point = [number, number];
type Product = {
  id: number;
  type: string;
  feasible?: boolean;
  monitoring: boolean;
  monitoringNumber: number;
  images?: { acquisitionTime?: string }[];
  layers?: { name: string; format: string; json?: string }[];
  stats?: Record<string, { None?: { affected?: number | string; total?: number | string } }>;
  version?: { deliveryTime?: string };
};

type ActivationAoi = {
  name?: string;
  number?: number;
  products?: Product[];
};

type Activation = {
  code?: string;
  name?: string;
  aois?: ActivationAoi[];
};

type RemoteGeometry =
  | { type: "Polygon"; coordinates: Point[][] }
  | { type: "MultiPolygon"; coordinates: Point[][][] }
  | { type: "LineString"; coordinates: Point[] }
  | { type: "MultiLineString"; coordinates: Point[][] }
  | { type: "Point"; coordinates: Point }
  | { type: "MultiPoint"; coordinates: Point[] };
type RemoteFeatureCollection = {
  features: Array<{ geometry?: RemoteGeometry | null }>;
};

export type CopernicusFeatureProperties = {
  kind: "burnt-area" | "fire-front" | "active-flame";
  label: string;
  activationCode?: string;
  areaName?: string;
  sourceUrl?: string;
  product?: string;
  observedAt?: string;
  deliveredAt?: string | null;
  mappedAreaHectares?: number | null;
  fireIds?: string[];
};

export type CopernicusAreaSource = {
  activationCode: string;
  activationName: string;
  areaName: string;
  areaNumber: number;
  url: string;
  fireIds: string[];
  areaProduct: string;
  areaObservedAt: string;
  areaDeliveredAt: string | null;
  mappedAreaHectares: number | null;
  activeFlames: number;
  frontProduct: string | null;
  frontObservedAt: string | null;
  frontKilometres: number | null;
};

export type CopernicusFireMap = FeatureCollection<
  MultiPolygon | MultiLineString | MultiPoint,
  CopernicusFeatureProperties
> & {
  source: {
    activationCode: string;
    label: string;
    url: string;
    readAt: string;
    areaProduct: string;
    areaObservedAt: string;
    areaDeliveredAt: string | null;
    mappedAreaHectares: number | null;
    activeFlames: number;
    frontProduct: string | null;
    frontObservedAt: string | null;
    frontKilometres: number | null;
    geometryVersion: string;
    areas: CopernicusAreaSource[];
  };
};

type ProductGeometry = {
  polygons: Point[][][];
  lines: Point[][];
  points: Point[];
};

const metadataCache = new Map<
  string,
  { expiresAt: number; activation: Activation }
>();
const productGeometryCache = new Map<string, Promise<ProductGeometry>>();

const activationUrl = (code: string) =>
  `https://mapping.emergency.copernicus.eu/activations/${code}/`;

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!response.ok) throw new Error(`Copernicus respondió ${response.status}`);
  return response.json() as Promise<T>;
};

const originalGeometryPath = (url: string) =>
  join(
    originalGeometryDirectory,
    `${createHash("sha256").update(url).digest("hex")}.json`,
  );

const validRemoteCollection = (value: unknown): value is RemoteFeatureCollection =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as Partial<RemoteFeatureCollection>).features),
  );

const readOriginalGeometry = async (
  url: string,
): Promise<RemoteFeatureCollection | undefined> => {
  try {
    const value = JSON.parse(
      await readFile(originalGeometryPath(url), "utf8"),
    ) as unknown;
    return validRemoteCollection(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const writeOriginalGeometry = async (url: string, raw: string) => {
  const path = originalGeometryPath(url);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, raw, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
};

const fetchOriginalGeometry = async (url: string) => {
  const cached = await readOriginalGeometry(url);
  if (cached) return cached;
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!response.ok) throw new Error(`Copernicus respondió ${response.status}`);
  const raw = await response.text();
  const value = JSON.parse(raw) as unknown;
  if (!validRemoteCollection(value)) {
    throw new Error("Copernicus devolvió una geometría no válida");
  }
  await writeOriginalGeometry(url, raw);
  return value;
};

const officialJsonUrl = (product: Product, fragment: string) => {
  const rawUrl = product.layers?.find(
    (layer) => layer.format === "vt" && layer.name.includes(fragment),
  )?.json;
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.hostname !== DATA_HOST) {
    throw new Error("Copernicus devolvió una fuente no permitida");
  }
  return url.toString();
};

const observedAt = (product: Product) =>
  product.images?.[0]?.acquisitionTime || product.version?.deliveryTime || "";

const productKey = (product: Product) =>
  product.type === "FEP"
    ? "FEP_PRODUCT"
    : product.monitoring
      ? `DEL_MONIT${String(product.monitoringNumber).padStart(2, "0")}`
      : "DEL_PRODUCT";

const statNumber = (
  product: Product | null,
  category: string,
  field: "affected" | "total" = "affected",
) => {
  const value = product?.stats?.[category]?.None?.[field];
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : 0;
};

const squareDistance = (a: Point, b: Point) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

const segmentSquareDistance = (point: Point, start: Point, end: Point) => {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const projection =
      ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (projection > 1) {
      [x, y] = end;
    } else if (projection > 0) {
      x += dx * projection;
      y += dy * projection;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
};

const simplifyPoints = (
  points: Point[],
  squareTolerance = TOLERANCE * TOLERANCE,
): Point[] => {
  if (points.length <= 2) return points;
  let maxDistance = squareTolerance;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = segmentSquareDistance(points[index], points[0], points.at(-1)!);
    if (distance > maxDistance) {
      splitIndex = index;
      maxDistance = distance;
    }
  }
  if (!splitIndex) return [points[0], points.at(-1)!];
  const left = simplifyPoints(points.slice(0, splitIndex + 1), squareTolerance);
  const right = simplifyPoints(points.slice(splitIndex), squareTolerance);
  return [...left.slice(0, -1), ...right];
};

const simplifyRadialDistance = (
  points: Point[],
  squareTolerance = TOLERANCE * TOLERANCE,
) => {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  let previous = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (squareDistance(point, previous) > squareTolerance) {
      simplified.push(point);
      previous = point;
    }
  }
  if (previous !== points.at(-1)) simplified.push(points.at(-1)!);
  return simplified;
};

const roundPoint = ([lon, lat]: Point): Point => [
  Math.round(lon * 10000) / 10000,
  Math.round(lat * 10000) / 10000,
];

const simplifyLine = (coordinates: Point[]) =>
  simplifyPoints(simplifyRadialDistance(coordinates.map(roundPoint))).filter(
    (point, index, points) =>
      index === 0 || squareDistance(point, points[index - 1]) > 0,
  );

const simplifyRing = (coordinates: Point[]) => {
  const openRing =
    coordinates.length > 1 && squareDistance(coordinates[0], coordinates.at(-1)!) === 0
      ? coordinates.slice(0, -1)
      : coordinates;
  const simplified = simplifyLine(openRing);
  const valid = simplified.length >= 3 ? simplified : openRing.map(roundPoint);
  return valid.length ? [...valid, valid[0]] : [];
};

const ringArea = (coordinates: Point[]) => {
  if (coordinates.length < 3) return 0;
  let doubledArea = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    const next = coordinates[(index + 1) % coordinates.length];
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(doubledArea) / 2;
};

const simplifyPolygon = (polygon: Point[][]) => {
  const [exterior, ...holes] = polygon;
  if (!exterior || ringArea(exterior) < MIN_EXTERIOR_AREA_DEGREES) return [];
  const simplifiedExterior = simplifyRing(exterior);
  if (simplifiedExterior.length < 4) return [];
  const simplifiedHoles = holes
    .filter((ring) => ringArea(ring) >= MIN_HOLE_AREA_DEGREES)
    .map(simplifyRing)
    .filter((ring) => ring.length >= 4);
  return [simplifiedExterior, ...simplifiedHoles];
};

const polygonsFrom = (collection: RemoteFeatureCollection): Point[][][] =>
  collection.features.flatMap((feature): Point[][][] => {
    if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiPolygon") return feature.geometry.coordinates;
    return [];
  });

const linesFrom = (collection: RemoteFeatureCollection): Point[][] =>
  collection.features.flatMap((feature): Point[][] => {
    if (feature.geometry?.type === "LineString") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiLineString") return feature.geometry.coordinates;
    return [];
  });

const pointsFrom = (collection: RemoteFeatureCollection): Point[] =>
  collection.features.flatMap((feature): Point[] => {
    if (feature.geometry?.type === "Point") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiPoint") return feature.geometry.coordinates;
    return [];
  });

const getActivation = async (code: string) => {
  const cached = metadataCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.activation;
  const url = new URL(API_ROOT);
  url.searchParams.set("code", code);
  const response = await fetchJson<Activation & { results?: Activation[] }>(url.toString());
  const activation = response.results?.[0] || response;
  if (!activation?.aois?.length) throw new Error(`Sin áreas para ${code}`);
  metadataCache.set(code, {
    expiresAt: Date.now() + METADATA_TTL_MS,
    activation,
  });
  return activation;
};

const getProductGeometry = async (product: Product): Promise<ProductGeometry> => {
  const key = `${product.id}:${observedAt(product)}`;
  const cached = productGeometryCache.get(key);
  if (cached) return cached;

  const geometryPromise = (async () => {
    const areaUrl = officialJsonUrl(product, "_observedEventA_");
    const frontUrl = officialJsonUrl(product, "_observedEventL_");
    const flameUrl = officialJsonUrl(product, "_observedEventP_");
    const [area, fronts, flames] = await Promise.all([
      areaUrl
        ? fetchOriginalGeometry(areaUrl)
        : Promise.resolve({ features: [] }),
      frontUrl
        ? fetchOriginalGeometry(frontUrl)
        : Promise.resolve({ features: [] }),
      flameUrl
        ? fetchOriginalGeometry(flameUrl)
        : Promise.resolve({ features: [] }),
    ]);
    return {
      polygons: polygonsFrom(area)
        .map(simplifyPolygon)
        .filter((polygon) => polygon.length),
      lines: linesFrom(fronts).map(simplifyLine).filter((line) => line.length >= 2),
      points: pointsFrom(flames).map(roundPoint),
    };
  })();
  productGeometryCache.set(key, geometryPromise);
  try {
    return await geometryPromise;
  } catch (error) {
    productGeometryCache.delete(key);
    throw error;
  }
};

const fireIdsFor = (activationCode: string, areaNumber: number) => {
  const mappings: Record<string, string[]> = {
    "EMSR900:2": ["sierra-oeste"],
    "EMSR900:3": ["burgohondo-fire", "sierra-oeste"],
    "EMSR898:1": ["la-mierla-fire"],
    "EMSR898:2": ["la-mierla-fire"],
  };
  return mappings[`${activationCode}:${areaNumber}`] || [];
};

const latestProductWith = (products: Product[], fragment: string) =>
  [...products]
    .filter((product) => product.feasible !== false && officialJsonUrl(product, fragment))
    .sort((left, right) => Date.parse(observedAt(left)) - Date.parse(observedAt(right)))
    .at(-1) || null;

const buildAoi = async (
  activationCode: string,
  activationName: string,
  aoi: ActivationAoi,
) => {
  const products = (aoi.products || []).filter((product) =>
    ["DEL", "FEP"].includes(product.type),
  );
  const deliveredProducts = products.filter((product) => product.layers?.length);
  const deliveredDelineations = deliveredProducts.some((product) => product.type === "DEL")
    ? deliveredProducts.filter((product) => product.type === "DEL")
    : deliveredProducts;
  const areaProduct = latestProductWith(deliveredDelineations, "_observedEventA_");
  if (!areaProduct) return null;
  const frontProduct = latestProductWith(deliveredProducts, "_observedEventL_");
  const flameProduct = latestProductWith(deliveredProducts, "_observedEventP_");
  const uniqueProducts = [...new Map(
    [areaProduct, frontProduct, flameProduct]
      .filter((product): product is Product => Boolean(product))
      .map((product) => [product.id, product]),
  ).values()];
  const geometryEntries = await Promise.all(
    uniqueProducts.map(async (product) => [product.id, await getProductGeometry(product)] as const),
  );
  const geometryByProduct = new Map(geometryEntries);
  const areaGeometry = geometryByProduct.get(areaProduct.id)!;
  const frontGeometry = frontProduct ? geometryByProduct.get(frontProduct.id) : undefined;
  const flameGeometry = flameProduct ? geometryByProduct.get(flameProduct.id) : undefined;
  if (!areaGeometry.polygons.length) return null;

  const areaNumber = aoi.number || 0;
  const areaName = aoi.name || `Área ${areaNumber}`;
  const url = activationUrl(activationCode);
  const fireIds = fireIdsFor(activationCode, areaNumber);
  const mappedAreaHectares =
    statNumber(areaProduct, "Burnt area", "affected") ||
    statNumber(areaProduct, "Burnt area", "total") ||
    null;
  const source: CopernicusAreaSource = {
    activationCode,
    activationName,
    areaName,
    areaNumber,
    url,
    fireIds,
    areaProduct: productKey(areaProduct),
    areaObservedAt: observedAt(areaProduct),
    areaDeliveredAt: areaProduct.version?.deliveryTime || null,
    mappedAreaHectares,
    activeFlames: statNumber(flameProduct, "Active Flames"),
    frontProduct: frontProduct ? productKey(frontProduct) : null,
    frontObservedAt: frontProduct ? observedAt(frontProduct) : null,
    frontKilometres: statNumber(frontProduct, "Fire Fronts") || null,
  };
  const commonProperties = {
    activationCode,
    areaName,
    sourceUrl: url,
    fireIds,
  };
  const features: CopernicusFireMap["features"] = [
    {
      type: "Feature",
      properties: {
        ...commonProperties,
        kind: "burnt-area",
        label: `${areaName} · área cartografiada`,
        product: source.areaProduct,
        observedAt: source.areaObservedAt,
        deliveredAt: source.areaDeliveredAt,
        mappedAreaHectares,
      },
      geometry: { type: "MultiPolygon", coordinates: areaGeometry.polygons },
    },
  ];
  if (frontGeometry?.lines.length) {
    features.push({
      type: "Feature",
      properties: {
        ...commonProperties,
        kind: "fire-front",
        label: `${areaName} · frente observado`,
        product: source.frontProduct || undefined,
        observedAt: source.frontObservedAt || undefined,
      },
      geometry: { type: "MultiLineString", coordinates: frontGeometry.lines },
    });
  }
  if (flameGeometry?.points.length) {
    features.push({
      type: "Feature",
      properties: {
        ...commonProperties,
        kind: "active-flame",
        label: `${areaName} · llama activa observada`,
        product: flameProduct ? productKey(flameProduct) : undefined,
        observedAt: flameProduct ? observedAt(flameProduct) : undefined,
      },
      geometry: { type: "MultiPoint", coordinates: flameGeometry.points },
    });
  }
  return { source, features };
};

export const getCopernicusFireMap = async (): Promise<CopernicusFireMap> => {
  const activationResults = await Promise.allSettled(
    ACTIVATION_CODES.map(async (code) => ({ code, activation: await getActivation(code) })),
  );
  const aoiResults = await Promise.allSettled(
    activationResults.flatMap((result) =>
      result.status === "fulfilled"
        ? (result.value.activation.aois || []).map((aoi) =>
            buildAoi(
              result.value.code,
              result.value.activation.name || result.value.code,
              aoi,
            ),
          )
        : [],
    ),
  );
  const areas = aoiResults.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  if (!areas.length) {
    throw new Error("No hay productos Copernicus entregados para la zona Centro");
  }
  const areaSources = areas.map((area) => area.source);
  const latestArea = [...areaSources].sort(
    (left, right) => Date.parse(right.areaObservedAt) - Date.parse(left.areaObservedAt),
  )[0];
  const latestFront = [...areaSources]
    .filter((area) => area.frontObservedAt)
    .sort(
      (left, right) =>
        Date.parse(right.frontObservedAt || "") - Date.parse(left.frontObservedAt || ""),
    )[0];
  const activationCode = [...new Set(areaSources.map((area) => area.activationCode))].join(", ");
  const geometryVersion = createHash("sha256")
    .update(
      JSON.stringify({
        displayGeometryVersion: DISPLAY_GEOMETRY_VERSION,
        areas: areaSources.map((area) => ({
          activationCode: area.activationCode,
          areaNumber: area.areaNumber,
          areaProduct: area.areaProduct,
          areaObservedAt: area.areaObservedAt,
          frontProduct: area.frontProduct,
          frontObservedAt: area.frontObservedAt,
        })),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    type: "FeatureCollection",
    source: {
      activationCode,
      label: `Copernicus EMS Rapid Mapping · ${activationCode}`,
      url: latestArea.url,
      readAt: new Date().toISOString(),
      areaProduct: latestArea.areaProduct,
      areaObservedAt: latestArea.areaObservedAt,
      areaDeliveredAt: latestArea.areaDeliveredAt,
      mappedAreaHectares:
        areaSources.reduce((total, area) => total + (area.mappedAreaHectares || 0), 0) ||
        null,
      activeFlames: areaSources.reduce((total, area) => total + area.activeFlames, 0),
      frontProduct: latestFront?.frontProduct || null,
      frontObservedAt: latestFront?.frontObservedAt || null,
      frontKilometres:
        areaSources.reduce((total, area) => total + (area.frontKilometres || 0), 0) ||
        null,
      geometryVersion,
      areas: areaSources,
    },
    features: areas.flatMap((area) => area.features),
  };
};
