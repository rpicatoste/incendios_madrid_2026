import { getLiveRegion } from "../../../lib/live-region";

export async function GET() {
  const region = await getLiveRegion();
  return Response.json(region, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
