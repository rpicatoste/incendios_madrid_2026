export const MADRID_STATUS_SOURCE =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";

export type MadridStatus = {
  lastUpdated: string;
  evacuated: string[];
  confined: string[];
  shelters: string[];
  roads: string[];
  fetchedAt: string;
  sourceOk: boolean;
  authoritative: {
    evacuated: boolean;
    confined: boolean;
    shelters: boolean;
    roads: boolean;
  };
};

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
  confined: ["San Martín de Valdeiglesias", "Pelayos de la Presa"],
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
    "Navalcarnero",
  ],
  roads: ["M-507", "M540", "M501", "M-541", "M510", "M-512", "M-531", "M-539", "M-533", "M-521"],
};

let memoryCache:
  | {
      expiresAt: number;
      payload: MadridStatus;
    }
  | undefined;

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
  if (start < 0) return { found: false, items: [] as string[] };
  const listEnd = html.indexOf("</ul>", start);
  if (listEnd < 0) return { found: false, items: [] as string[] };
  const section = html.slice(start, listEnd + 5);
  return {
    found: true,
    items: [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((match) => decode(match[1]))
      .filter(Boolean),
  };
};

export const getMadridStatus = async (): Promise<MadridStatus> => {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.payload;

  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(MADRID_STATUS_SOURCE, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "FOCO-Centro/2.0" },
      cf: { cacheTtl: 120, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const updatedMatch = html.match(/<strong>\s*Última actualización:\s*([^<]+)<\/strong>/i);
    const evacuatedSection = listAfter(
      html,
      /(?:Municipios evacuados|Localidades desalojadas):/i,
    );
    const confinedSection = listAfter(
      html,
      /(?:Municipios confinados|Confinamientos):/i,
    );
    const sheltersSection = listAfter(html, /<h3[^>]*>\s*Puntos de acogida:/i);
    const roadsSection = listAfter(html, /<h3[^>]*>\s*Cortes de carreteras:/i);
    const evacuated = evacuatedSection.items
      .filter((item) => !/^(?:Municipios evacuados|Localidades desalojadas):?$/i.test(item))
      .map((item) => item.replace(/\.$/, ""));
    const confined = confinedSection.items
      .filter((item) => !/^(?:Municipios confinados|Confinamientos):?$/i.test(item))
      .map((item) => item.replace(/\.$/, ""));
    const shelters = sheltersSection.items;
    const roads = roadsSection.items.map((row) => row.split(":")[0].trim());
    const payload: MadridStatus = {
      lastUpdated: updatedMatch
        ? decode(updatedMatch[1]).replace(" a las ", " · ")
        : fallback.lastUpdated,
      evacuated: evacuatedSection.found ? evacuated : fallback.evacuated,
      confined: confinedSection.found ? confined : fallback.confined,
      shelters: sheltersSection.found ? shelters : fallback.shelters,
      roads: roadsSection.found ? roads : fallback.roads,
      fetchedAt,
      sourceOk: true,
      authoritative: {
        evacuated: evacuatedSection.found,
        confined: confinedSection.found,
        shelters: sheltersSection.found,
        roads: roadsSection.found,
      },
    };
    memoryCache = { expiresAt: Date.now() + 2 * 60 * 1000, payload };
    return payload;
  } catch {
    const payload: MadridStatus = {
      ...fallback,
      fetchedAt,
      sourceOk: false,
      authoritative: {
        evacuated: false,
        confined: false,
        shelters: false,
        roads: false,
      },
    };
    memoryCache = { expiresAt: Date.now() + 30 * 1000, payload };
    return payload;
  }
};
