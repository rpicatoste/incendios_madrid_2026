import { getMadridStatus, type MadridStatus } from "../../../lib/madrid-status";

const MADRID_URL =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const CLM_URL =
  "https://castillalamancha.es/actualidad/notasdeprensa/garcia-page-avanza-que-el-incendio-de-la-mierla-guadalajara-desciende-nivel-1-mientras-se-acorrala";
const DSN_URL = "https://www.dsn.gob.es/gl/node/32742";
const JCYL_SOURCE_URL =
  "https://analisis.datosabiertos.jcyl.es/explore/dataset/incendios-forestales/";
const JCYL_API_URL =
  "https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/incendios-forestales/records?where=search%28termino_municipal%2C%22BURGOHONDO%22%29&order_by=orden%20desc&limit=1";
const FIDIAS_URL =
  "https://fidias.castillalamancha.es/consulta/forms/fidif001.php";
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
};

const xProfiles = [
  {
    key: "x112",
    username: "112cmadrid",
    relevant: /incend|evac|confin|acogida|es-alert|infoma|humo|carretera|sierra oeste/i,
  },
  {
    key: "infocam",
    username: "Plan_INFOCAM",
    relevant: /la mierla|guadalajara|almorox|toledo/i,
  },
  {
    key: "x112cyl",
    username: "112cyl",
    relevant: /burgohondo|navaluenga|el tiemblo|ávila|avila/i,
  },
  {
    key: "ume",
    username: "UMEgob",
    relevant: /sierra oeste|burgohondo|la mierla|madrid|ávila|avila|guadalajara/i,
  },
] as const;

type OfficialNews = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string;
  source: string;
};

export type OfficialIncident = {
  id: string;
  name: string;
  province: string;
  status: string;
  detail: string;
  updatedAt: string;
  updatedLabel?: string;
  url: string;
  source: string;
};

let memoryCache:
  | {
      expiresAt: number;
      payload: {
        items: OfficialNews[];
        incidents: OfficialIncident[];
        readAt: string;
        sourceReads: Record<string, { url: string; readAt: string; ok: boolean }>;
      };
    }
  | undefined;

const decodeText = (raw: string) =>
  raw
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\n|\\r|\r?\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseOfficialTweets = (
  html: string,
  profile: (typeof xProfiles)[number],
): OfficialNews[] => {
  const markers = [...html.matchAll(/"client:(VHdlZXQ6[A-Za-z0-9+/=]+):details":\$R\[\d+\]=\{/g)];
  const items: OfficialNews[] = [];

  markers.forEach((marker, index) => {
    const decoded = Buffer.from(marker[1], "base64").toString("utf8");
    const id = decoded.match(/^Tweet:(\d+)$/)?.[1];
    if (!id) return;
    const end = markers[index + 1]?.index || Math.min(html.length, marker.index! + 16000);
    const segment = html.slice(marker.index, end);
    const rawText = segment.match(/full_text:"((?:\\.|[^"])*)"/)?.[1];
    const createdAtMs = Number(segment.match(/created_at_ms:(\d+)/)?.[1]);
    if (!rawText || !Number.isFinite(createdAtMs)) return;
    const text = decodeText(rawText);
    if (!profile.relevant.test(text)) return;
    items.push({
      id: `x-${id}`,
      title: text.length > 96 ? `${text.slice(0, 93).trim()}…` : text,
      body: text,
      publishedAt: new Date(createdAtMs).toISOString(),
      url: `https://x.com/${profile.username}/status/${id}`,
      source: `@${profile.username}`,
    });
  });

  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, 6);
};

const fetchHtml = async (url: string) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FOCO-Centro/2.0; +https://github.com/rpicatoste/incendios_madrid_2026)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

const fetchBurgohondo = async (): Promise<OfficialIncident> => {
  const response = await fetch(JCYL_API_URL, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    results?: Array<{
      fecha_del_parte?: string;
      hora_del_parte?: string;
      nivel?: string;
      situacion_actual?: string;
      tipo_y_has_de_superficie_afectada?: string;
    }>;
  };
  const record = payload.results?.[0];
  if (!record?.fecha_del_parte || !record.hora_del_parte || !record.situacion_actual) {
    throw new Error("Parte de Burgohondo incompleto");
  }
  const status = record.situacion_actual.toLowerCase();
  return {
    id: "burgohondo",
    name: "Burgohondo",
    province: "Ávila",
    status: status[0].toUpperCase() + status.slice(1),
    detail: `Nivel ${record.nivel || "—"} · ${record.tipo_y_has_de_superficie_afectada || "superficie sin publicar"}`,
    updatedAt: `${record.fecha_del_parte}T${record.hora_del_parte}:00+02:00`,
    url: JCYL_SOURCE_URL,
    source: "Datos Abiertos · Junta de Castilla y León",
  };
};

const parseSpanishDate = (value: string) => {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return match
    ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00+02:00`
    : null;
};

const fetchLaMierla = async (readAt: string): Promise<OfficialIncident> => {
  const login = await fetch(`${FIDIAS_URL}?auth=ANONIMO`, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "FOCO-Centro/2.0" },
  });
  if (!login.ok) throw new Error(`HTTP ${login.status}`);
  const cookieHeaders =
    (login.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ||
    [login.headers.get("set-cookie") || ""];
  const cookie = cookieHeaders
    .filter(Boolean)
    .map((value) => value.split(";")[0])
    .join("; ");
  const response = await fetch(FIDIAS_URL, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": "FOCO-Centro/2.0",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({
      accion: "detalle",
      CINCENDI: "2026190275",
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes("2026190275") || !html.includes("Detalle del incendio")) {
    throw new Error("FIDIAS no devolvió la ficha de La Mierla");
  }
  const plain = decodeText(html);
  const level = plain.match(/\bNIVEL:\s*(\d+)/i)?.[1] || "—";
  const control = plain.match(/\bCONTROL:\s*(Sin especificar|\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i)?.[1] || "Sin especificar";
  const extinction = plain.match(/\bEXTINCIÓN:\s*(Sin especificar|\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i)?.[1] || "Sin especificar";
  const extinctionAt = parseSpanishDate(extinction);
  const controlAt = parseSpanishDate(control);
  const status = extinctionAt ? "Extinguido" : controlAt ? "Controlado" : `Nivel ${level}`;
  return {
    id: "la-mierla",
    name: "La Mierla",
    province: "Guadalajara",
    status,
    detail: extinctionAt
      ? `Extinción registrada ${extinction}`
      : controlAt
        ? `Control registrado ${control}`
        : "Control y extinción: sin especificar",
    updatedAt: extinctionAt || controlAt || readAt,
    updatedLabel: extinctionAt || controlAt ? undefined : "FIDIAS leído",
    url: `${FIDIAS_URL}?auth=ANONIMO`,
    source: "FIDIAS · Junta de Castilla-La Mancha",
  };
};

export async function GET() {
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return Response.json(memoryCache.payload, { headers: CACHE_HEADERS });
  }

  const readAt = new Date().toISOString();
  const results = await Promise.allSettled([
    ...xProfiles.map((profile) => fetchHtml(`https://x.com/${profile.username}`)),
    fetchHtml(MADRID_URL),
    fetchHtml(CLM_URL),
    fetchHtml(DSN_URL),
    fetchBurgohondo(),
    fetchLaMierla(readAt),
    getMadridStatus(),
  ]);
  const profileResults = results.slice(0, xProfiles.length);
  const madridPage = results[xProfiles.length];
  const clmPage = results[xProfiles.length + 1];
  const dsnPage = results[xProfiles.length + 2];
  const burgohondoResult = results[xProfiles.length + 3];
  const laMierlaResult = results[xProfiles.length + 4];
  const madridStatusResult = results[xProfiles.length + 5];

  const items = profileResults
    .flatMap((result, index) =>
      result.status === "fulfilled"
        ? parseOfficialTweets(result.value as string, xProfiles[index])
        : [],
    )
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, 14);

  const incidents: OfficialIncident[] = [];
  if (madridStatusResult.status === "fulfilled") {
    const status = madridStatusResult.value as MadridStatus;
    incidents.push({
      id: "sierra-oeste",
      name: "Sierra Oeste",
      province: "Madrid · Toledo",
      status: status.incidentStatus,
      detail: "Emergencia de interés nacional",
      updatedAt: status.fetchedAt,
      updatedLabel: status.lastUpdated,
      url: MADRID_URL,
      source: "Comunidad de Madrid",
    });
  }
  if (burgohondoResult.status === "fulfilled") {
    incidents.push(burgohondoResult.value as OfficialIncident);
  }
  if (laMierlaResult.status === "fulfilled") {
    incidents.push(laMierlaResult.value as OfficialIncident);
  }

  const sourceReads: Record<string, { url: string; readAt: string; ok: boolean }> = {};
  xProfiles.forEach((profile, index) => {
    sourceReads[profile.key] = {
      url: `https://x.com/${profile.username}`,
      readAt,
      ok: profileResults[index].status === "fulfilled",
    };
  });
  Object.assign(sourceReads, {
    madrid: { url: MADRID_URL, readAt, ok: madridPage.status === "fulfilled" },
    clm: { url: CLM_URL, readAt, ok: clmPage.status === "fulfilled" },
    dsn: { url: DSN_URL, readAt, ok: dsnPage.status === "fulfilled" },
    jcyl: { url: JCYL_SOURCE_URL, readAt, ok: burgohondoResult.status === "fulfilled" },
    fidias: { url: `${FIDIAS_URL}?auth=ANONIMO`, readAt, ok: laMierlaResult.status === "fulfilled" },
  });

  const payload = { items, incidents, readAt, sourceReads };
  memoryCache = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
  return Response.json(payload, { headers: CACHE_HEADERS });
}
