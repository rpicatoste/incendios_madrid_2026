import assert from "node:assert/strict";
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
  assert.match(html, /MITECO · calidad del aire/);
  assert.match(html, /Abrir panel de situación/);
  assert.match(html, /Copernicus EMSR898/);
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

  const unknown = await request("/admin");
  assert.equal(unknown.status, 404);
});

test("keeps upstream access fixed and the production listener private", async () => {
  const [airRoute, snapshotRoute, worker, service, dashboard, css] = await Promise.all([
    readFile(new URL("../app/api/air/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/snapshots/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../ops/foco-app.service", import.meta.url), "utf8"),
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(airRoute, /const ICA_URL = "https:\/\/ica\.miteco\.es\/datos\/ica-ultima-hora\.csv"/);
  assert.doesNotMatch(airRoute, /child_process|execFile|spawn\(/);
  assert.match(snapshotRoute, /timingSafeEqual/);
  assert.match(snapshotRoute, /declaredLength > 128/);
  assert.match(snapshotRoute, /captureFromServer\(request\)/);
  assert.match(worker, /\["GET", "HEAD"\]/);
  assert.match(service, /--hostname 127\.0\.0\.1/);
  assert.doesNotMatch(service, /--hostname 0\.0\.0\.0/);
  assert.match(dashboard, /L\.circleMarker\(\[station\.lat, station\.lon\]/);
  assert.doesNotMatch(dashboard, /L\.marker\(\[station\.lat, station\.lon\]/);
  assert.match(dashboard, /pane: "foco-user-location"/);
  assert.match(dashboard, /zIndexOffset: 2000/);
  assert.match(css, /\.topbar\s*\{\s*height:\s*46px;/);
  assert.match(css, /\.forecast-panel\.open\s*\{\s*height:\s*176px;/);
  assert.doesNotMatch(css, /\.map-legend\.forecast-open\s*\{[^}]*opacity:\s*0/s);
});
