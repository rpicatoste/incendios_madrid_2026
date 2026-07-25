import { defaultRegionData } from "../../../lib/region-data";

export async function GET() {
  return Response.json({
    ...defaultRegionData,
    fetchedAt: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
