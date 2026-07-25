import { buildLiveRegion } from "../../../lib/live-region";
import { getMadridStatus } from "../../../lib/madrid-status";

export async function GET() {
  const status = await getMadridStatus();
  const region = await buildLiveRegion(status);
  return Response.json({
    ...region,
    fetchedAt: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
