const SOURCE =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
};

let memoryCache:
  | {
      expiresAt: number;
      payload: Record<string, unknown>;
    }
  | undefined;

const fallback = {
  lastUpdated: "24 de julio · 23:30 h",
  evacuated: [
    "Camping El Escorial",
    "Navas del Rey",
    "Chapinería",
    "Colmenar del Arroyo",
    "Aldea del Fresno",
    "Robledo de Chavela",
    "Fresnedillas de la Oliva",
    "Navalagamella",
    "Zarzalejo",
  ],
  shelters: [
    "Villaviciosa de Odón",
    "Móstoles",
    "Alcalá de Henares",
    "Brunete",
    "Leganés",
    "Villanueva de la Cañada",
    "Villamantilla",
    "Villanueva de Perales",
    "Getafe",
    "Villamanta",
    "Alcobendas",
    "Las Rozas",
    "Alcorcón",
  ],
  roads: ["M-50", "M-540", "M-501", "M-541", "M-510", "M-512", "M-531", "M-539", "M-533", "M-521"],
};

const decode = (value: string) =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/\s+/g, " ")
    .trim();

const listAfter = (html: string, startPattern: RegExp) => {
  const start = html.search(startPattern);
  if (start < 0) return [];
  const section = html.slice(start, html.indexOf("</ul>", start) + 5);
  return [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => decode(match[1]))
    .filter(Boolean);
};

export async function GET() {
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return Response.json(memoryCache.payload, { headers: CACHE_HEADERS });
  }

  try {
    const response = await fetch(SOURCE, {
      headers: { "User-Agent": "FOCO-Madrid/1.0" },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (!response.ok) throw new Error("Source unavailable");
    const html = await response.text();

    const updatedMatch = html.match(/<strong>\s*Última actualización:\s*([^<]+)<\/strong>/i);
    const evacuated = listAfter(html, /Municipios evacuados:/i).slice(1);
    const shelters = listAfter(html, /<h3>\s*Puntos de acogida:/i);
    const roadRows = listAfter(html, /<h3>\s*Cortes de carreteras:/i);
    const roads = roadRows.map((row) => row.split(":")[0].trim());

    const payload = {
      lastUpdated: updatedMatch ? decode(updatedMatch[1]).replace(" a las ", " · ") : fallback.lastUpdated,
      evacuated: evacuated.length ? evacuated : fallback.evacuated,
      shelters: shelters.length ? shelters : fallback.shelters,
      roads: roads.length ? roads : fallback.roads,
      fetchedAt: new Date().toISOString(),
    };
    memoryCache = { expiresAt: Date.now() + 2 * 60 * 1000, payload };
    return Response.json(payload, { headers: CACHE_HEADERS });
  } catch {
    return Response.json(
      { ...fallback, fetchedAt: new Date().toISOString() },
      { headers: CACHE_HEADERS },
    );
  }
}
