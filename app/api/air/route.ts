const STATIONS_URL =
  "https://idem.comunidad.madrid/geoidem/InstalacionesMedioAmbiente/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=InstalacionesMedioAmbiente:IDEM_MA_EST_CALIDAD_AIRE&outputFormat=application/json&srsName=EPSG:4326";
const REGION_URL =
  "https://datos.comunidad.madrid/catalogo/dataset/3dacd589-ecca-485c-81b9-a61606b7199f/resource/93bed3f0-3ba5-4b00-90bf-1c81951bab24/download/calidad_aire_datos_dia.json";
const CITY_URL =
  "https://datos.madrid.es/dataset/212531-0-calidad-aire-tiempo-real/resource/212531-0-calidad-aire-tiempo-real/download/212531-0-calidad-aire-tiempo-real.json";

type Reading = Record<string, string>;

const pollutantMeta: Record<number, { name: string; thresholds: number[]; rolling: boolean }> = {
  1: { name: "SO₂", thresholds: [100, 200, 350, 500, 750], rolling: false },
  8: { name: "NO₂", thresholds: [40, 90, 120, 230, 340], rolling: false },
  9: { name: "PM2.5", thresholds: [10, 20, 25, 50, 75], rolling: true },
  10: { name: "PM10", thresholds: [20, 40, 50, 100, 150], rolling: true },
  14: { name: "O₃", thresholds: [50, 100, 130, 240, 380], rolling: false },
};

const quality = [
  { label: "buena", color: "#45d49a" },
  { label: "razonablemente buena", color: "#a7d66d" },
  { label: "regular", color: "#ffd45a" },
  { label: "desfavorable", color: "#ff994f" },
  { label: "muy desfavorable", color: "#ef586f" },
  { label: "extremadamente desfavorable", color: "#9c5cc8" },
];

const field = (row: Reading, key: string) => row[key] ?? row[key.toUpperCase()] ?? "";

const stationCode = (row: Reading) =>
  Number(
    `${field(row, "provincia").padStart(2, "0")}${field(row, "municipio").padStart(3, "0")}${field(row, "estacion").padStart(3, "0")}`,
  );

const summarize = (row: Reading) => {
  const values: { hour: number; value: number }[] = [];
  for (let hour = 1; hour <= 24; hour += 1) {
    const suffix = String(hour).padStart(2, "0");
    const validation = field(row, `v${suffix}`);
    const raw = field(row, `h${suffix}`);
    const value = Number(String(raw).replace(",", "."));
    if (validation !== "N" && raw !== "" && Number.isFinite(value)) values.push({ hour, value });
  }
  if (!values.length) return null;
  const magnitude = Number(field(row, "magnitud"));
  const meta = pollutantMeta[magnitude];
  if (!meta) return null;
  const latest = values.at(-1)!;
  const value = meta.rolling
    ? values.reduce((sum, item) => sum + item.value, 0) / values.length
    : latest.value;
  const level = meta.thresholds.findIndex((threshold) => value <= threshold);
  return {
    magnitude,
    pollutant: meta.name,
    value: Math.round(value * 10) / 10,
    hour: `${String(latest.hour).padStart(2, "0")}:00`,
    severity: level < 0 ? 5 : level,
  };
};

export async function GET() {
  try {
    const requestOptions = {
      headers: { "User-Agent": "FOCO-Madrid/1.0" },
      cf: { cacheTtl: 1800, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } };

    const [stationsResponse, regionResponse, cityResponse] = await Promise.all([
      fetch(STATIONS_URL, requestOptions),
      fetch(REGION_URL, requestOptions),
      fetch(CITY_URL, requestOptions),
    ]);
    if (!stationsResponse.ok || !regionResponse.ok || !cityResponse.ok) throw new Error("Air data unavailable");

    const [stationGeo, regionData, cityData] = await Promise.all([
      stationsResponse.json() as Promise<any>,
      regionResponse.json() as Promise<any>,
      cityResponse.json() as Promise<any>,
    ]);

    const readings = [...(regionData.data || []), ...(cityData.records || [])] as Reading[];
    const byStation = new Map<number, ReturnType<typeof summarize>[]>();

    readings.forEach((row) => {
      const summary = summarize(row);
      if (!summary) return;
      const code = stationCode(row);
      byStation.set(code, [...(byStation.get(code) || []), summary]);
    });

    const stations = (stationGeo.features || []).map((feature: any) => {
      const id = Number(feature.properties.CD_CODIGO);
      const readingsForStation = (byStation.get(id) || []).filter(Boolean) as NonNullable<ReturnType<typeof summarize>>[];
      const worst = readingsForStation.sort((a, b) => b.severity - a.severity)[0];
      const status = worst ? quality[worst.severity] : { label: "sin dato", color: "#7f8c90" };
      return {
        id,
        name: feature.properties.DS_MUNICIPIO || "Estación",
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        label: status.label,
        color: status.color,
        pollutant: worst?.pollutant || null,
        value: worst?.value ?? null,
        hour: worst?.hour || null,
      };
    });

    return Response.json({ stations, fetchedAt: new Date().toISOString() });
  } catch {
    return Response.json({ stations: [], fetchedAt: new Date().toISOString() }, { status: 200 });
  }
}
