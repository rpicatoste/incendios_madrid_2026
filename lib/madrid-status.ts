export const MADRID_STATUS_SOURCE =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";

export type MadridStatus = {
  lastUpdated: string;
  updatedAt: string;
  evacuated: string[];
  evacuatedAreaCount: number;
  evacuationDetails: Record<string, string>;
  confined: string[];
  shelters: string[];
  roads: string[];
  incidentStatus: string;
  fetchedAt: string;
  sourceOk: boolean;
  authoritative: {
    incident: boolean;
    evacuated: boolean;
    confined: boolean;
    shelters: boolean;
    roads: boolean;
  };
};

const fallback = {
  lastUpdated: "24 de julio · 23:30 h",
  updatedAt: "2026-07-24T23:30:00+02:00",
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
  evacuatedAreaCount: 9,
  evacuationDetails: {},
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
  incidentStatus: "Situación Operativa 3",
};

let memoryCache:
  | {
      expiresAt: number;
      payload: MadridStatus;
    }
  | undefined;

const decode = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
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

const isShelterSummary = (value: string) =>
  /^(?:Personas|Escuelas|Residencias(?: y centros)?|Atenciones|La Comunidad|\d+\s+Autobuses|\d+\s+puntos?\s+de Atención)/i.test(value);

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const parsePageUpdate = (html: string, plainText: string) => {
  const explicit = plainText.match(
    /ÚLTIMA ACTUALIZACIÓN\s*-\s*(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)?\s*(\d{1,2})\s+de\s+([a-záéíóúñ]+),?\s+a las\s+(\d{1,2}):(\d{2})\s*h?/i,
  );
  const modified = html.match(
    /<meta\s+property="article:modified_time"\s+content="([^"]+)"/i,
  )?.[1];
  if (explicit) {
    const monthName = explicit[2].toLowerCase();
    const month = MONTHS[monthName];
    const year = modified && !Number.isNaN(Date.parse(modified))
      ? new Date(modified).getFullYear()
      : new Date().getFullYear();
    if (month) {
      const day = Number(explicit[1]);
      const hour = Number(explicit[3]);
      const minute = Number(explicit[4]);
      const offset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
      return {
        label: `${day} de ${monthName} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} h`,
        iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`,
      };
    }
  }
  if (modified && !Number.isNaN(Date.parse(modified))) {
    return { label: fallback.lastUpdated, iso: modified };
  }
  return { label: fallback.lastUpdated, iso: fallback.updatedAt };
};

const remainingEvacuations = (html: string) => {
  const start = html.search(/Siguen evacuadas\s+\d+\s+urbanizaciones:/i);
  if (start < 0) {
    return {
      found: false,
      items: [] as string[],
      details: {} as Record<string, string>,
      declaredCount: undefined as number | undefined,
    };
  }
  const nextMeasure = html.indexOf("La Comunidad de Madrid", start);
  const section = html.slice(
    start,
    nextMeasure > start ? nextMeasure : Math.min(html.length, start + 12000),
  );
  const municipalities = [
    ...section.matchAll(/<li[^>]*>\s*En\s*<strong>([\s\S]*?)<\/strong>\s*:?/gi),
  ];
  const items: string[] = [];
  const details: Record<string, string> = {};
  const declaredCount = Number(
    decode(section).match(/Siguen evacuadas\s+(\d+)\s+urbanizaciones/i)?.[1],
  );
  municipalities.forEach((match, index) => {
    const name = decode(match[1]).replace(/:$/, "");
    if (!name) return;
    const subsection = section.slice(
      match.index,
      municipalities[index + 1]?.index ?? section.length,
    );
    const areas = [
      ...subsection.matchAll(/<li[^>]*>\s*([^<][^<]*?)\s*<\/li>/gi),
    ]
      .map((area) => decode(area[1]).replace(/\.$/, ""))
      .filter((area) => area && !/^En\s*$/i.test(area));
    items.push(name);
    details[name] = areas.length
      ? `${areas.length} urbanizaciones siguen sin retorno: ${areas.join(", ")}.`
      : "La fuente oficial mantiene zonas de este municipio sin retorno.";
  });
  return {
    found: items.length > 0,
    items,
    details,
    declaredCount: Number.isFinite(declaredCount) ? declaredCount : undefined,
  };
};

const roadCodes = (items: string[]) =>
  [...new Set(
    items.flatMap((item) =>
      [...item.matchAll(/\bM-?\d{3}\b/gi)].map((match) =>
        match[0].toUpperCase().replace(/^M(?=\d)/, "M-"),
      ),
    ),
  )];

export const parseMadridStatusHtml = (
  html: string,
  fetchedAt = new Date().toISOString(),
): MadridStatus => {
  const plainText = decode(html);
  const pageUpdate = parsePageUpdate(html, plainText);
  const legacyEvacuatedSection = listAfter(
    html,
    /(?:Municipios evacuados|Localidades desalojadas):/i,
  );
  const currentEvacuations = remainingEvacuations(html);
  const confinedSection = listAfter(
    html,
    /(?:Municipios confinados|Confinamientos):/i,
  );
  const sheltersSection = listAfter(html, /<h3[^>]*>\s*Puntos de acogida:/i);
  const sheltersClosed =
    /cierra la totalidad de los \d+ puntos de acogida|puntos de acogida[\s\S]{0,180}ya están cerrados/i.test(
      plainText,
    );
  const roadsSection = listAfter(
    html,
    /<h3[^>]*>\s*(?:<strong>)?\s*(?:Cortes de carreteras|Carreteras):/i,
  );
  const evacuatedSection = currentEvacuations.found
    ? currentEvacuations
    : legacyEvacuatedSection;
  const evacuated = evacuatedSection.items
    .filter((item) => !/^(?:Municipios evacuados|Localidades desalojadas):?$/i.test(item))
    .map((item) => item.replace(/\.$/, ""));
  const confined = confinedSection.items
    .filter((item) => !/^(?:Municipios confinados|Confinamientos):?$/i.test(item))
    .map((item) => item.replace(/\.$/, ""));
  const shelters = sheltersClosed
    ? []
    : sheltersSection.items.filter((item) => !isShelterSummary(item));
  const roads = roadCodes(roadsSection.items);
  const currentStatusText = plainText.split(/Conoce las situaciones de emergencia/i)[0];
  const operationalMatches = [
    ...currentStatusText.matchAll(
      /(?:continúa|mantiene|pasa a|en)\s+(?:la\s+)?situación operativa\s*([0-3])/gi,
    ),
  ];
  const operationalLevel = operationalMatches.at(-1)?.[1];
  const explicitState = currentStatusText.match(
    /\b(extinguido|controlado|estabilizado|estabilizada)\b/i,
  )?.[1];
  const stateLabel = explicitState
    ? explicitState.toLowerCase().startsWith("estabiliz")
      ? "estabilizado"
      : explicitState.toLowerCase()
    : "";

  return {
    lastUpdated: pageUpdate.label,
    updatedAt: pageUpdate.iso,
    evacuated: evacuatedSection.found ? evacuated : fallback.evacuated,
    evacuatedAreaCount: currentEvacuations.found
      ? currentEvacuations.declaredCount ?? evacuated.length
      : evacuatedSection.found
        ? evacuated.length
        : fallback.evacuatedAreaCount,
    evacuationDetails: currentEvacuations.found
      ? currentEvacuations.details
      : fallback.evacuationDetails,
    confined: confinedSection.found || currentEvacuations.found
      ? confined
      : fallback.confined,
    shelters: sheltersSection.found || sheltersClosed ? shelters : fallback.shelters,
    roads: roadsSection.found ? roads : fallback.roads,
    incidentStatus: operationalLevel
      ? `Situación Operativa ${operationalLevel}${stateLabel ? ` · ${stateLabel}` : ""}`
      : stateLabel
        ? stateLabel[0].toUpperCase() + stateLabel.slice(1)
        : fallback.incidentStatus,
    fetchedAt,
    sourceOk: true,
    authoritative: {
      incident: Boolean(operationalLevel || stateLabel),
      evacuated: evacuatedSection.found,
      confined: confinedSection.found || currentEvacuations.found,
      shelters: sheltersSection.found || sheltersClosed,
      roads: roadsSection.found,
    },
  };
};

const fetchMadridStatus = async (): Promise<MadridStatus> => {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(MADRID_STATUS_SOURCE, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "FOCO-Centro/2.0" },
      cf: { cacheTtl: 120, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const payload = parseMadridStatusHtml(html, fetchedAt);
    memoryCache = { expiresAt: Date.now() + 2 * 60 * 1000, payload };
    return payload;
  } catch {
    const payload: MadridStatus = {
      ...fallback,
      fetchedAt,
      sourceOk: false,
      authoritative: {
        incident: false,
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

let pendingRequest: Promise<MadridStatus> | undefined;

export const getMadridStatus = async (): Promise<MadridStatus> => {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.payload;
  pendingRequest ||= fetchMadridStatus().finally(() => {
    pendingRequest = undefined;
  });
  return pendingRequest;
};
