const ICA_URL = "https://ica.miteco.es/datos/ica-ultima-hora.csv";
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
};

let memoryCache:
  | {
      expiresAt: number;
      payload: Record<string, unknown>;
    }
  | undefined;
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

export async function GET() {
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return Response.json(memoryCache.payload, { headers: CACHE_HEADERS });
  }

  try {
    const response = await fetch(ICA_URL, {
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
          hour: observedAt ? `${observedAt.slice(8, 10)}/${observedAt.slice(5, 7)} · ${observedAt.slice(11, 16)} UTC` : null,
          observedAt: observedAt ? `${observedAt}Z` : null,
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

    const payload = {
      stations,
      fetchedAt: new Date().toISOString(),
      source: ICA_URL,
      sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
    };
    memoryCache = { expiresAt: Date.now() + 15 * 60 * 1000, payload };
    return Response.json(payload, { headers: CACHE_HEADERS });
  } catch {
    const payload = {
        stations: [],
        fetchedAt: new Date().toISOString(),
        source: ICA_URL,
        sourceLabel: "Índice Nacional de Calidad del Aire · MITECO",
      };
    return Response.json(payload, { status: 200, headers: CACHE_HEADERS });
  }
}
