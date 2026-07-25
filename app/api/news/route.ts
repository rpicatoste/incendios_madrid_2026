const X_PROFILE_URL = "https://x.com/112cmadrid";
const MADRID_URL =
  "https://www.comunidad.madrid/seguridad-emergencias-asem-112/incendio-forestal-sierra-oeste-ifsierraoeste-julio-2026";
const CLM_URL =
  "https://www.castillalamancha.es/actualidad/notasdeprensa/castilla-la-mancha-moviliza-un-amplio-operativo-para-hacer-frente-los-incendios-registrados-en-la";
const DSN_URL = "https://www.dsn.gob.es/gl/node/32742";
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
};
const RELEVANT =
  /incend|evac|confin|acogida|es-alert|infoma|humo|carretera|sierra oeste/i;

type OfficialNews = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string;
  source: string;
};

let memoryCache:
  | {
      expiresAt: number;
      payload: {
        items: OfficialNews[];
        readAt: string;
        sourceReads: Record<string, { url: string; readAt: string; ok: boolean }>;
      };
    }
  | undefined;

const decodeFlightText = (raw: string) =>
  raw
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\n|\\r|\r?\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();

const parseOfficialTweets = (html: string): OfficialNews[] => {
  const markers = [...html.matchAll(/"client:(VHdlZXQ6[A-Za-z0-9+/=]+):details":\$R\[\d+\]=\{/g)];
  const items: OfficialNews[] = [];

  markers.forEach((marker, index) => {
    const decoded = Buffer.from(marker[1], "base64").toString("utf8");
    const id = decoded.match(/^Tweet:(\d+)$/)?.[1];
    if (!id) return;
    const end = markers[index + 1]?.index || Math.min(html.length, marker.index! + 12000);
    const segment = html.slice(marker.index, end);
    const rawText = segment.match(/full_text:"((?:\\.|[^"])*)"/)?.[1];
    const createdAtMs = Number(segment.match(/created_at_ms:(\d+)/)?.[1]);
    if (!rawText || !Number.isFinite(createdAtMs)) return;
    const text = decodeFlightText(rawText);
    if (!RELEVANT.test(text)) return;
    items.push({
      id: `x-${id}`,
      title: text.length > 96 ? `${text.slice(0, 93).trim()}…` : text,
      body: text,
      publishedAt: new Date(createdAtMs).toISOString(),
      url: `https://x.com/112cmadrid/status/${id}`,
      source: "@112cmadrid",
    });
  });

  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, 6);
};

const fetchOfficial = async (url: string, body = false) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FOCO-Centro/2.0; +https://github.com/rpicatoste/incendios_madrid_2026)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body ? response.text() : "";
};

export async function GET() {
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return Response.json(memoryCache.payload, { headers: CACHE_HEADERS });
  }

  const readAt = new Date().toISOString();
  const checks = await Promise.allSettled([
    fetchOfficial(X_PROFILE_URL, true),
    fetchOfficial(MADRID_URL),
    fetchOfficial(CLM_URL),
    fetchOfficial(DSN_URL),
  ]);
  const urls = [X_PROFILE_URL, MADRID_URL, CLM_URL, DSN_URL];
  const keys = ["x112", "madrid", "clm", "dsn"];
  const sourceReads = Object.fromEntries(
    checks.map((result, index) => [
      keys[index],
      { url: urls[index], readAt, ok: result.status === "fulfilled" },
    ]),
  );
  const items =
    checks[0].status === "fulfilled" ? parseOfficialTweets(checks[0].value) : [];
  const payload = { items, readAt, sourceReads };
  memoryCache = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
  return Response.json(payload, { headers: CACHE_HEADERS });
}
