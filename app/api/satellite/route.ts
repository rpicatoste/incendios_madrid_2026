import {
  readSatelliteLayer,
  readSatelliteManifest,
  SATELLITE_LAYERS,
  type SatelliteLayer,
} from "../../../lib/satellite-snapshots";

const HOUR_PATTERN = /^(?:\d{4}-\d{2}-\d{2}T\d{2}|live)$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hour = url.searchParams.get("hour") || "";
  const layer = url.searchParams.get("layer") || "";
  const isManifest = layer === "manifest";
  if (
    !HOUR_PATTERN.test(hour) ||
    (!isManifest && !SATELLITE_LAYERS.includes(layer as SatelliteLayer))
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const contents = isManifest
      ? await readSatelliteManifest(hour)
      : await readSatelliteLayer(hour, layer as SatelliteLayer);
    const isLive = hour === "live";
    const versioned = Boolean(url.searchParams.get("v"));
    const cacheControl = !isLive
      ? "public, max-age=31536000, immutable"
      : isManifest
        ? "public, max-age=300, stale-while-revalidate=86400"
        : versioned
          ? "public, max-age=31536000, immutable"
          : "no-store";
    return new Response(contents, {
      headers: {
        "Content-Type":
          layer === "copernicus" || layer === "effis"
            ? "application/geo+json"
            : isManifest
              ? "application/json"
              : "image/png",
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
