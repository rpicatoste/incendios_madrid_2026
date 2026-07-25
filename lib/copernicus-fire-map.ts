const ACTIVATION_CODE = "EMSR898";
const ACTIVATION_URL = `https://mapping.emergency.copernicus.eu/activations/${ACTIVATION_CODE}/`;
const API_URL =
  `https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=${ACTIVATION_CODE}`;
const DATA_HOST = "rapidmapping-viewer.s3.eu-west-1.amazonaws.com";
const TOLERANCE = 0.00025;
const METADATA_TTL_MS = 15 * 60 * 1000;

type Point = [number, number];
type Product = {
  id: number;
  type: string;
  monitoring: boolean;
  monitoringNumber: number;
  images?: { acquisitionTime?: string }[];
  layers?: { name: string; format: string; json?: string }[];
  stats?: Record<string, { None?: { affected?: number } }>;
  version?: { deliveryTime?: string };
};

type ProductGeometry = {
  polygons: Point[][][];
  lines: Point[][];
  points: Point[];
};

let metadataCache:
  | { expiresAt: number; activation: { aois?: { products?: Product[] }[] } }
  | undefined;
const productGeometryCache = new Map<string, Promise<ProductGeometry>>();

const fetchJson = async (url: string) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!response.ok) throw new Error(`Copernicus respondió ${response.status}`);
  return response.json();
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
  product.monitoring
    ? `DEL_MONIT${String(product.monitoringNumber).padStart(2, "0")}`
    : "DEL_PRODUCT";

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
  Math.round(lon * 100000) / 100000,
  Math.round(lat * 100000) / 100000,
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
  return [...valid, valid[0]];
};

const polygonsFrom = (collection: any): Point[][][] =>
  collection.features.flatMap((feature: any) => {
    if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiPolygon") return feature.geometry.coordinates;
    return [];
  });

const linesFrom = (collection: any): Point[][] =>
  collection.features.flatMap((feature: any) => {
    if (feature.geometry?.type === "LineString") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiLineString") return feature.geometry.coordinates;
    return [];
  });

const pointsFrom = (collection: any): Point[] =>
  collection.features.flatMap((feature: any) => {
    if (feature.geometry?.type === "Point") return [feature.geometry.coordinates];
    if (feature.geometry?.type === "MultiPoint") return feature.geometry.coordinates;
    return [];
  });

const getActivation = async () => {
  if (metadataCache && metadataCache.expiresAt > Date.now()) {
    return metadataCache.activation;
  }
  const response = await fetchJson(API_URL);
  const activation = response.results?.[0] || response;
  metadataCache = { expiresAt: Date.now() + METADATA_TTL_MS, activation };
  return activation;
};

const getProductGeometry = async (product: Product): Promise<ProductGeometry> => {
  const key = `${productKey(product)}:${observedAt(product)}`;
  const cached = productGeometryCache.get(key);
  if (cached) return cached;

  const geometryPromise = (async () => {
    const areaUrl = officialJsonUrl(product, "_observedEventA_");
    const frontUrl = officialJsonUrl(product, "_observedEventL_");
    const flameUrl = officialJsonUrl(product, "_observedEventP_");
    const [area, fronts, flames] = await Promise.all([
      areaUrl ? fetchJson(areaUrl) : Promise.resolve({ features: [] }),
      frontUrl ? fetchJson(frontUrl) : Promise.resolve({ features: [] }),
      flameUrl ? fetchJson(flameUrl) : Promise.resolve({ features: [] }),
    ]);
    return {
      polygons: polygonsFrom(area).map((polygon) => polygon.map(simplifyRing)),
      lines: linesFrom(fronts).map(simplifyLine),
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

export const getCopernicusFireMap = async () => {
  const activation = await getActivation();
  const products = [...(activation.aois?.[0]?.products || [])]
    .filter((product: Product) => product.type === "DEL")
    .sort(
      (a: Product, b: Product) =>
        new Date(observedAt(a)).getTime() - new Date(observedAt(b)).getTime(),
    );
  if (!products.length) throw new Error(`No hay delimitación para ${ACTIVATION_CODE}`);

  const latestProduct = products.at(-1)!;
  const areaProductIndex = products.reduce(
    (bestIndex, product, index) =>
      (product.stats?.["Burnt area"]?.None?.affected || 0) >
      (products[bestIndex]?.stats?.["Burnt area"]?.None?.affected || 0)
        ? index
        : bestIndex,
    0,
  );
  const areaProduct = products[areaProductIndex];
  const latestFrontProduct =
    [...products]
      .reverse()
      .find((product) => officialJsonUrl(product, "_observedEventL_")) || null;
  const uniqueProducts = [...new Map(
    [areaProduct, latestProduct, latestFrontProduct]
      .filter(Boolean)
      .map((product) => [productKey(product as Product), product as Product]),
  ).values()];
  const geometryEntries = await Promise.all(
    uniqueProducts.map(async (product) => [productKey(product), await getProductGeometry(product)] as const),
  );
  const geometryByProduct = new Map(geometryEntries);
  const areaGeometry = geometryByProduct.get(productKey(areaProduct))!;
  const latestGeometry = geometryByProduct.get(productKey(latestProduct))!;
  const latestFrontGeometry = latestFrontProduct
    ? geometryByProduct.get(productKey(latestFrontProduct))
    : null;
  const mappedArea = areaProduct.stats?.["Burnt area"]?.None?.affected || 0;

  return {
    type: "FeatureCollection",
    source: {
      activationCode: ACTIVATION_CODE,
      label: `Copernicus EMS Rapid Mapping · ${ACTIVATION_CODE}`,
      url: ACTIVATION_URL,
      readAt: new Date().toISOString(),
      areaProduct: productKey(areaProduct),
      areaObservedAt: observedAt(areaProduct),
      areaDeliveredAt: areaProduct.version?.deliveryTime || null,
      mappedAreaHectares: mappedArea || null,
      activeFlames: latestProduct.stats?.["Active Flames"]?.None?.affected || 0,
      frontProduct: latestFrontProduct ? productKey(latestFrontProduct) : null,
      frontObservedAt: latestFrontProduct ? observedAt(latestFrontProduct) : null,
      frontKilometres:
        latestFrontProduct?.stats?.["Fire Fronts"]?.None?.affected || null,
    },
    features: [
      {
        type: "Feature",
        properties: { kind: "burnt-area", label: "Área recorrida cartografiada" },
        geometry: {
          type: "MultiPolygon",
          coordinates: areaGeometry.polygons,
        },
      },
      {
        type: "Feature",
        properties: { kind: "fire-front", label: "Frente observado" },
        geometry: {
          type: "MultiLineString",
          coordinates: latestFrontGeometry?.lines || [],
        },
      },
      {
        type: "Feature",
        properties: { kind: "active-flame", label: "Llama activa observada" },
        geometry: { type: "MultiPoint", coordinates: latestGeometry.points },
      },
    ],
  };
};
