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
  assert.match(html, /Seguimiento activo/);
  assert.match(html, /Humo VIIRS/);
  assert.match(html, /Actualidad/);
  assert.match(html, /Evacuaciones/);
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
  assert.match(dashboard, /Producto diario, sin hora fija/);
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
  assert.equal(dashboard.includes("currentWindDirection === null"), true);
  assert.equal(dashboard.includes("currentWindDirection ?? 0"), true);
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
  assert.match(dashboard, /rotate\(\$\{hour\.windDirection\}deg\)/);
  assert.match(dashboard, /weather_code,is_day/);
  assert.match(dashboard, /className="sky-symbol"/);
  assert.match(dashboard, /className="wind-particles"/);
  assert.match(dashboard, /width < 700 \? 18 : 34/);
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
  assert.match(dashboard, /Frente observado/);
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
  assert.match(newsRoute, /Promise\.allSettled/);
  assert.doesNotMatch(newsRoute, /request\.url|searchParams/);
  assert.match(statusRoute, /getMadridStatus/);
  assert.match(madridStatus, /authoritative/);
  assert.match(madridStatus, /pendingRequest \|\|= fetchMadridStatus/);
  assert.match(madridStatus, /Municipios evacuados/);
  assert.match(liveRegion, /status\.authoritative\.evacuated/);
  assert.match(liveRegion, /nominatim\.openstreetmap\.org\/search/);
  assert.match(liveRegion, /geocodes\.json/);
  assert.match(liveRegion, /live-region\.json/);
  assert.match(liveRegion, /LIVE_REGION_CACHE_TTL_MS = 5/);
  assert.match(madridStatus, /isShelterSummary/);
  assert.match(regionData, /guadalajaraEvacuations/);
  assert.match(regionData, /guadalajaraConfinements/);
  assert.match(regionData, /guadalajaraPoint\("hiendelaencina"/);
  assert.match(regionData, /guadalajaraPoint\("albendiego"/);
  assert.match(regionData, /20 jul · última relación nominal/);
  assert.match(css, /\.topbar\s*\{\s*height:\s*46px;/);
  assert.match(css, /\.forecast-panel\.open\s*\{\s*height:\s*176px;/);
  assert.match(css, /\.wind-particles/);
  assert.match(css, /\.weather-temperature/);
  assert.doesNotMatch(css, /\.map-legend\.forecast-open\s*\{[^}]*opacity:\s*0/s);
});
