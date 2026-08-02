import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function request(path = "/", init) {
  const worker = await loadWorker();
  return worker.fetch(new Request(`http://localhost${path}`, init), environment, context);
}

test("classifies freshness from the observation time with a strict 48 hour window", async () => {
  const { isRecentObservation, parseObservationTime, RECENT_DATA_WINDOW_MS } = await import(
    "../lib/data-freshness.ts"
  );
  const reference = Date.parse("2026-08-02T12:00:00Z");
  assert.equal(RECENT_DATA_WINDOW_MS, 48 * 60 * 60 * 1000);
  assert.equal(isRecentObservation("2026-07-31T12:00:00Z", reference), true);
  assert.equal(isRecentObservation("2026-07-31T11:59:59Z", reference), false);
  assert.equal(isRecentObservation("2026-08-02T13:00:00Z", reference), true);
  assert.equal(isRecentObservation("2026-08-02T20:00:00Z", reference), false);
  assert.equal(isRecentObservation("invalid", reference), false);
  assert.equal(isRecentObservation(undefined, reference), false);
  assert.equal(
    parseObservationTime("2026-08-02T10:54:00"),
    Date.parse("2026-08-02T10:54:00Z"),
  );
});

test("parses the current Madrid restrictions without reviving old fallbacks", async () => {
  const { parseMadridStatusHtml } = await import("../lib/madrid-status.ts");
  const html = `
    <meta property="article:modified_time" content="2026-08-02T11:17:23+02:00">
    <p><strong>ÚLTIMA ACTUALIZACIÓN - Domingo 2 de agosto, a las 09:00h</strong></p>
    <p>La situación del incendio se ha declarado como estabilizada.</p>
    <p>Domingo 2 de agosto continúa la situación operativa 2 del INFOMA 26.</p>
    <ul>
      <li>Siguen evacuadas 7 urbanizaciones:
        <ul>
          <li>En <strong>Pelayos de la Presa</strong>:
            <ul><li>El Mirador de Pelayos.</li><li>Las Musas.</li></ul>
          </li>
          <li>En <strong>San Martín de Valdeiglesias</strong>:
            <ul><li>Costa de Madrid.</li><li>San Ramón.</li><li>Javacruz.</li><li>La Javariega.</li><li>Veracruz.</li></ul>
          </li>
        </ul>
      </li>
      <li>La Comunidad de Madrid cierra la totalidad de los 24 puntos de acogida.</li>
    </ul>
    <h3><strong>Carreteras:</strong></h3>
    <ul><li>Permanece cortada la carretera M-957.</li></ul>
  `;
  const status = parseMadridStatusHtml(html, "2026-08-02T13:30:00Z");
  assert.equal(status.lastUpdated, "2 de agosto · 09:00 h");
  assert.equal(status.updatedAt, "2026-08-02T09:00:00+02:00");
  assert.equal(status.incidentStatus, "Situación Operativa 2 · estabilizado");
  assert.deepEqual(status.evacuated, [
    "Pelayos de la Presa",
    "San Martín de Valdeiglesias",
  ]);
  assert.equal(status.evacuatedAreaCount, 7);
  assert.match(status.evacuationDetails["Pelayos de la Presa"], /Las Musas/);
  assert.match(status.evacuationDetails["San Martín de Valdeiglesias"], /Veracruz/);
  assert.deepEqual(status.confined, []);
  assert.deepEqual(status.shelters, []);
  assert.deepEqual(status.roads, ["M-957"]);
  assert.deepEqual(status.authoritative, {
    incident: true,
    evacuated: true,
    confined: true,
    shelters: true,
    roads: true,
  });

  const unrecognized = parseMadridStatusHtml(
    '<meta property="article:modified_time" content="2026-08-02T12:00:00+02:00"><p>Formato nuevo sin estado estructurado.</p>',
  );
  assert.equal(unrecognized.authoritative.incident, false);
  assert.equal(unrecognized.authoritative.evacuated, false);
});

test("server-renders FOCO Centro with the public security policy", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(response.headers.get("content-security-policy") ?? "", /form-action 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  const html = await response.text();
  assert.match(html, /<b>FOCO<\/b><small>CENTRO<\/small>/);
  assert.match(html, /Vista reciente/);
  assert.match(html, /histórico oculto/);
  assert.match(html, /Humo VIIRS/);
  assert.match(html, /Actualidad/);
  assert.match(html, /Situación/);
  assert.match(html, /Fuentes/);
  assert.match(html, /Abrir panel de situación/);
  assert.match(html, /Copernicus EMSR900 \+ EMSR898/);
  assert.match(html, /Viento suave/);
  assert.match(html, /Temperatura, cielo, viento y lluvia/);
  assert.match(html, /Ver incendios/);
  assert.doesNotMatch(html, /codex-preview|unpkg\.com|\/Users\/|\/home\/rpica/);
});

test("rejects public mutations and hides the internal snapshot capture route", async () => {
  const put = await request("/", { method: "PUT" });
  assert.equal(put.status, 405);

  const deletion = await request("/", { method: "DELETE" });
  assert.equal(deletion.status, 405);

  const snapshotPost = await request("/api/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capture: true }),
  });
  assert.equal(snapshotPost.status, 404);

  const analyticsPost = await request("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-the-private-key" }),
  });
  assert.equal(analyticsPost.status, 404);

  const analyticsGet = await request("/api/analytics");
  assert.equal(analyticsGet.status, 404);

  const visitorsPage = await request("/visitas", {
    headers: { accept: "text/html" },
  });
  assert.equal(visitorsPage.status, 200);
  const visitorsHtml = await visitorsPage.text();
  assert.match(visitorsHtml, /PANEL PRIVADO/);
  assert.doesNotMatch(visitorsHtml, /Personas hoy/);

  const unknown = await request("/admin");
  assert.equal(unknown.status, 404);

  const traversal = await request("/api/satellite?hour=../../etc&layer=burnt");
  assert.equal(traversal.status, 404);
});

test("keeps upstream access fixed and the production listener private", async () => {
  const [
    airRoute,
    snapshotRoute,
    satelliteRoute,
    satelliteSnapshots,
    effisAreaStatus,
    copernicusMap,
    worker,
    service,
    dashboard,
    css,
    newsRoute,
    statusRoute,
    madridStatus,
    liveRegion,
    regionData,
    windRoute,
    windField,
    freshness,
    fnmtCertificate,
  ] = await Promise.all([
    readFile(new URL("../app/api/air/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/snapshots/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/satellite/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/satellite-snapshots.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/effis-area-status.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/copernicus-fire-map.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../ops/foco-app.service", import.meta.url), "utf8"),
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/madrid-status.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/live-region.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/region-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wind-field/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wind-field.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-freshness.ts", import.meta.url), "utf8"),
    readFile(new URL("../ops/fnmt-components.pem", import.meta.url), "utf8"),
  ]);

  const [analyticsLib, analyticsRoute, visitRoute, visitorsClient] = await Promise.all([
    readFile(new URL("../lib/visitor-analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analytics/visit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/visitas/VisitorAnalytics.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(airRoute, /const ICA_URL = "https:\/\/ica\.miteco\.es\/datos\/ica-ultima-hora\.csv"/);
  assert.equal(["child_process", "execFile", "spawn("].some((term) => airRoute.includes(term)), false);
  assert.equal(airRoute.includes('timeZone: "Europe/Madrid"'), true);
  assert.equal(airRoute.includes("sourceOk: true"), true);
  assert.equal(airRoute.includes("responseFromCache(cached, true)"), true);
  assert.equal(airRoute.includes("AbortSignal.timeout(10000)"), true);
  assert.equal(airRoute.includes("observationIsDelayed"), true);
  assert.equal(airRoute.includes("process.env.FOCO_DATA_DIR"), true);
  assert.equal(airRoute.includes("acquireRefreshLock"), true);
  assert.equal(airRoute.includes("writeDiskCache"), true);
  assert.equal(airRoute.includes("CACHE_SCHEMA_VERSION = 3"), true);
  assert.equal(airRoute.includes("air-quality-last-valid.json"), true);
  assert.equal(airRoute.includes("readSnapshotFallbackStations"), true);
  assert.doesNotMatch(airRoute, /LAST_VALID_MAX_AGE_MS/);
  assert.equal(airRoute.includes("carriedForward: true"), true);
  assert.equal(airRoute.includes("MIN_CURRENT_COVERAGE"), true);
  assert.equal(airRoute.includes("coverage:"), true);
  assert.equal(airRoute.includes('rawIndex.trim() !== ""'), true);
  assert.doesNotMatch(airRoute, /rejectUnauthorized\s*:\s*false/);
  assert.equal(
    createHash("sha256").update(fnmtCertificate).digest("hex"),
    "74a26ccb0f9ca1f7cdcbd2d4d4a58923c57165047d809b6b52cac50541a968ad",
  );
  assert.match(analyticsLib, /createHmac\("sha256", configuredToken\)/);
  assert.match(analyticsLib, /RETENTION_DAYS = 90/);
  assert.match(analyticsLib, /SESSION_WINDOW_MS = 30/);
  assert.match(analyticsLib, /request\.headers\.get\("dnt"\)/);
  assert.match(analyticsLib, /request\.headers\.get\("sec-gpc"\)/);
  assert.match(analyticsLib, /mode: 0o600/);
  assert.match(analyticsLib, /timingSafeEqual/);
  assert.doesNotMatch(analyticsLib, /ipAddress\s*:/);
  assert.doesNotMatch(analyticsLib, /userAgent:\s*userAgent/);
  assert.match(analyticsRoute, /declaredLength > 512/);
  assert.match(analyticsRoute, /analyticsTokenIsValid/);
  assert.match(visitRoute, /declaredLength > 16/);
  assert.match(visitRoute, /recordVisitor\(request\)/);
  assert.match(visitorsClient, /La clave no se guarda en el navegador/);
  assert.doesNotMatch(visitorsClient, /localStorage/);
  assert.match(snapshotRoute, /timingSafeEqual/);
  assert.match(snapshotRoute, /declaredLength > 128/);
  assert.match(snapshotRoute, /captureFromServer\(request, capturedAt\)/);
  assert.match(snapshotRoute, /freezeSatelliteSnapshot/);
  assert.match(snapshotRoute, /action: "reused"/);
  assert.match(snapshotRoute, /satellite\?\.schemaVersion === 4/);
  assert.match(snapshotRoute, /geometryVersion ===/);
  assert.match(snapshotRoute, /snapshots.map\(\(\{ id, capturedAt \}\)/);
  assert.match(snapshotRoute, /searchParams.get\("id"\)/);
  assert.match(snapshotRoute, /const payload = await captureFromServer/);
  assert.match(satelliteRoute, /HOUR_PATTERN/);
  assert.match(satelliteRoute, /X-Content-Type-Options/);
  assert.match(satelliteRoute, /layer === "copernicus" \|\| layer === "effis"/);
  assert.match(satelliteSnapshots, /effis\.nrt\.ba\.poly/);
  assert.match(satelliteSnapshots, /RASTER_REFRESH_INTERVAL_MS/);
  assert.match(satelliteSnapshots, /heat: 30 \* 60 \* 1000/);
  assert.match(satelliteSnapshots, /smoke: 6 \* 60 \* 60 \* 1000/);
  assert.match(satelliteSnapshots, /canReuseRaster/);
  assert.match(satelliteRoute, /versioned/);
  assert.match(satelliteRoute, /max-age=31536000, immutable/);
  assert.match(satelliteSnapshots, /getEffisAreaBundle/);
  assert.match(satelliteSnapshots, /"effis"/);
  assert.match(satelliteSnapshots, /schemaVersion: 4/);
  assert.match(effisAreaStatus, /api\.effis\.emergency\.copernicus\.eu\/rest\/2\/burntareas\/current/);
  assert.match(effisAreaStatus, /REFRESH_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(effisAreaStatus, /latestUpdateInView/);
  assert.match(effisAreaStatus, /EffisAreaMap/);
  assert.match(effisAreaStatus, /validGeometry/);
  assert.match(effisAreaStatus, /effis-area-bundle\.json/);
  assert.match(effisAreaStatus, /checkedAt/);
  assert.match(effisAreaStatus, /mode: 0o600/);
  assert.match(satelliteSnapshots, /VIIRS_SNPP_Aerosol_Type_Deep_Blue_Best_Estimate/);
  assert.match(satelliteSnapshots, /VIIRS_NOAA20_Thermal_Anomalies_375m_All/);
  assert.match(satelliteSnapshots, /VIIRS_SNPP_Thermal_Anomalies_375m_All/);
  assert.match(satelliteSnapshots, /burnt: \{ width: 4096, height: 2731 \}/);
  assert.match(satelliteSnapshots, /heat: \{ width: 1600, height: 1067 \}/);
  assert.match(satelliteSnapshots, /readPngDimensions/);
  assert.match(satelliteSnapshots, /schemaVersion: 4/);
  assert.match(satelliteSnapshots, /storedLayerIsValid/);
  assert.match(satelliteSnapshots, /value\.type === "FeatureCollection"/);
  assert.match(satelliteSnapshots, /pngHasVisiblePixels/);
  assert.match(satelliteSnapshots, /Imagen transparente sin datos/);
  assert.match(satelliteSnapshots, /layerSourceDate/);
  assert.match(satelliteSnapshots, /LOOKBACK_DAYS/);
  assert.match(satelliteSnapshots, /AbortSignal\.timeout\(45000\)/);
  assert.match(satelliteSnapshots, /captureSatelliteSnapshot/);
  assert.match(copernicusMap, /rapidmapping\.emergency\.copernicus\.eu/);
  assert.match(copernicusMap, /DATA_HOST = "rapidmapping-viewer\.s3\.eu-west-1\.amazonaws\.com"/);
  assert.match(copernicusMap, /"EMSR900", "EMSR898"/);
  assert.match(copernicusMap, /activation\.aois/);
  assert.match(copernicusMap, /latestProductWith/);
  assert.match(copernicusMap, /Promise\.allSettled/);
  assert.match(copernicusMap, /copernicus-original/);
  assert.match(copernicusMap, /mode: 0o600/);
  assert.match(copernicusMap, /MIN_HOLE_AREA_DEGREES/);
  assert.match(copernicusMap, /geometryVersion/);
  assert.match(worker, /\["GET", "HEAD"\]/);
  assert.match(worker, /\["\/api\/analytics", "\/api\/analytics\/visit"\]/);
  assert.doesNotMatch(worker, /maps\.effis\.emergency\.copernicus\.eu/);
  assert.match(service, /--hostname 127\.0\.0\.1/);
  assert.match(service, /NODE_EXTRA_CA_CERTS=.*\/ops\/fnmt-components\.pem/);
  assert.doesNotMatch(service, /--hostname 0\.0\.0\.0/);
  assert.match(dashboard, /L\.circleMarker\(\[station\.lat, station\.lon\]/);
  assert.equal(dashboard.includes("station.carriedForward"), true);
  assert.match(dashboard, /última lectura válida conservada/);
  assert.equal(dashboard.includes('dashArray: station.carriedForward ? "4 3"'), true);
  assert.match(dashboard, /NASA GIBS · calor VIIRS/);
  assert.match(dashboard, /layerSourceDate/);
  assert.match(dashboard, /vista reciente usa la fecha observada del incendio/);
  assert.match(dashboard, /procesado/);
  assert.match(dashboard, /effis\.csv/);
  assert.match(dashboard, /!hasFrozenSatellite && isLive/);
  assert.match(dashboard, /\[smokeVisible, setSmokeVisible\] = useState\(false\)/);
  assert.match(dashboard, /foco-visitor-recorded-v1/);
  assert.match(dashboard, /\/api\/analytics\/visit/);
  assert.match(dashboard, /globalPrivacyControl/);
  assert.equal(dashboard.includes("últimas válidas"), true);
  assert.doesNotMatch(dashboard, /L\.marker\(\[station\.lat, station\.lon\]/);
  assert.match(dashboard, /pane: "foco-user-location"/);
  assert.match(dashboard, /zIndexOffset: 2000/);
  assert.match(dashboard, /pane: "foco-forecast-point"/);
  assert.equal(dashboard.includes("forecast-point-symbol--map"), true);
  assert.equal(dashboard.includes('className="forecast-point-symbol forecast-point-symbol--title"'), true);
  assert.match(dashboard, /const windMovementDirection/);
  assert.match(dashboard, /windFromDegrees \+ 180/);
  assert.match(dashboard, /currentWindMovementDirection === null/);
  assert.match(dashboard, /fetch\("\/api\/wind-field"/);
  assert.match(dashboard, /if \(!windParticlesVisible\) return/);
  assert.match(dashboard, /sampleWindField/);
  assert.match(dashboard, /containerPointToLatLng/);
  assert.match(dashboard, /const lifetime = 1\.8/);
  assert.match(dashboard, /Object\.assign\(particle, makeParticle\(\)\)/);
  assert.doesNotMatch(dashboard, /latitude: "40\.4168"/);
  assert.equal(dashboard.includes("REFRESH_INTERVALS.forecast"), true);
  assert.equal(dashboard.includes('current: "wind_direction_10m,wind_speed_10m"'), true);
  assert.equal(dashboard.includes('forecast_hours: "12"'), true);
  assert.match(dashboard, /temperature_2m/);
  assert.match(dashboard, /weather-temperature/);
  assert.match(dashboard, /☀️/);
  assert.equal(dashboard.includes("if (!document.hidden) void refresh()"), true);
  const forecastAbort = dashboard.indexOf("forecastRequestRef.current?.abort();");
  const forecastCacheRead = dashboard.indexOf("const cachedForecast = forecastCacheRef.current.get(cacheKey);");
  assert.equal(forecastAbort >= 0 && forecastAbort < forecastCacheRead, true);
  assert.match(dashboard, /pointToLayer:[\s\S]*?bubblingMouseEvents: false/);
  assert.equal(dashboard.includes("scheduleRefresh(refreshAir, REFRESH_INTERVALS.air)"), true);
  assert.equal(dashboard.includes("bubblingMouseEvents: false"), true);
  assert.equal(dashboard.includes("requestForecast(point.lat, point.lon, point.name)"), false);
  assert.equal(dashboard.includes("requestForecast(station.lat, station.lon, station.name)"), false);
  assert.match(dashboard, /className="forecast-day-card"/);
  assert.match(dashboard, /startsDay/);
  assert.match(dashboard, /className="wind-arrow"/);
  assert.match(dashboard, /className="wind-stack"/);
  assert.match(dashboard, /className="wind-speed"/);
  assert.match(dashboard, /rotate\(\$\{windMovementDirection\(hour\.windDirection\)\}deg\)/);
  assert.doesNotMatch(dashboard, /rotate\(\$\{hour\.windDirection\}deg\)/);
  assert.match(dashboard, /Viento desde .* hacia/);
  assert.match(dashboard, /weather_code,is_day/);
  assert.match(dashboard, /className="sky-symbol"/);
  assert.match(dashboard, /className="wind-particles"/);
  assert.match(dashboard, /width < 700 \? 54 : 102/);
  assert.match(dashboard, /frameInterval = 1000 \/ 15/);
  assert.match(dashboard, /windParticlesVisible, setWindParticlesVisible\] = useState\(false\)/);
  assert.match(dashboard, /rgba\(0, 105, 190/);
  assert.match(dashboard, /api\/snapshots\?id=/);
  assert.match(dashboard, /geometryVersion/);
  assert.match(dashboard, /prefers-reduced-motion: reduce/);
  assert.match(dashboard, /layers\.effis/);
  assert.match(dashboard, /EffisAreaFeatureProperties/);
  assert.match(dashboard, /EMSR900 \+ EMSR898/);
  assert.match(dashboard, /L\.imageOverlay/);
  assert.match(dashboard, /event\.latlng\.lat, event\.latlng\.lng/);
  assert.match(dashboard, /Frente reciente/);
  assert.match(dashboard, /isRecentObservation/);
  assert.match(dashboard, /historicalVisible, setHistoricalVisible\] = useState\(false\)/);
  assert.match(dashboard, /HISTÓRICO >48 H/);
  assert.match(dashboard, /lastFireDate \|\| feature\.properties\.fireDate/);
  assert.match(dashboard, /feature\.properties\.observedAt/);
  assert.match(dashboard, /Centroides representativos; no perímetros oficiales/);
  assert.match(dashboard, /MITECO · calidad del aire/);
  assert.match(dashboard, /\["news", "Actualidad"\]/);
  assert.doesNotMatch(dashboard, /describeSun/);
  assert.match(newsRoute, /username: "112cmadrid"/);
  assert.match(newsRoute, /username: "Plan_INFOCAM"/);
  assert.match(newsRoute, /username: "112cyl"/);
  assert.match(newsRoute, /username: "UMEgob"/);
  assert.match(newsRoute, /analisis\.datosabiertos\.jcyl\.es/);
  assert.match(newsRoute, /fidias\.castillalamancha\.es/);
  assert.match(newsRoute, /DETECCIÓN/);
  assert.match(newsRoute, /updatedAt: extinctionAt \|\| controlAt \|\| detectionAt/);
  assert.doesNotMatch(newsRoute, /extinctionAt \|\| controlAt \|\| readAt/);
  assert.match(newsRoute, /Promise\.allSettled/);
  assert.doesNotMatch(newsRoute, /request\.url|searchParams/);
  assert.match(statusRoute, /getMadridStatus/);
  assert.match(madridStatus, /authoritative/);
  assert.match(madridStatus, /pendingRequest \|\|= fetchMadridStatus/);
  assert.match(madridStatus, /Municipios evacuados/);
  assert.match(madridStatus, /Siguen evacuadas/);
  assert.match(madridStatus, /parseMadridStatusHtml/);
  assert.match(madridStatus, /article:modified_time/);
  assert.match(madridStatus, /cierra la totalidad de los/);
  assert.match(liveRegion, /status\.authoritative\.evacuated/);
  assert.match(liveRegion, /status\.authoritative\.incident/);
  assert.match(liveRegion, /nominatim\.openstreetmap\.org\/search/);
  assert.match(liveRegion, /geocodes\.json/);
  assert.match(liveRegion, /live-region\.json/);
  assert.match(liveRegion, /LIVE_REGION_CACHE_TTL_MS = 5/);
  assert.match(liveRegion, /LIVE_REGION_CACHE_SCHEMA_VERSION = 3/);
  assert.match(liveRegion, /sourceObservedAt: status\.updatedAt/);
  assert.match(madridStatus, /isShelterSummary/);
  assert.match(regionData, /GUADALAJARA_RESTRICTIONS_LIFTED_SOURCE/);
  assert.match(regionData, /26 de julio se levantaron todas las evacuaciones/);
  assert.match(regionData, /sourceUpdatedAt: "26 jul"/);
  assert.match(regionData, /sourceObservedAt: "2026-07-26T12:00:00\+02:00"/);
  assert.doesNotMatch(regionData, /guadalajaraEvacuations/);
  assert.doesNotMatch(regionData, /guadalajaraConfinements/);
  assert.doesNotMatch(regionData, /guadalajaraPoint/);
  assert.match(windRoute, /getWindField/);
  assert.match(windRoute, /must-revalidate/);
  assert.match(windField, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(windField, /CACHE_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(windField, /FAILURE_RETRY_MS = 5 \* 60 \* 1000/);
  assert.match(windField, /rows: 7/);
  assert.match(windField, /columns: 9/);
  assert.match(windField, /wind-field\.json/);
  assert.match(windField, /mode: 0o600/);
  assert.match(windField, /refreshPromise \|\|=/);
  assert.match(windField, /sourceOk: false/);
  assert.doesNotMatch(windField, /setInterval/);
  assert.match(freshness, /RECENT_DATA_WINDOW_MS = 48/);
  assert.match(css, /\.topbar\s*\{\s*height:\s*46px;/);
  assert.match(css, /\.forecast-panel\.open\s*\{\s*height:\s*176px;/);
  assert.match(css, /\.wind-particles/);
  assert.match(css, /\.weather-temperature/);
  assert.match(css, /\.legend-heading--history/);
  assert.doesNotMatch(css, /\.map-legend\.forecast-open\s*\{[^}]*opacity:\s*0/s);
});
