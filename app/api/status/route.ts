import { getMadridStatus } from "../../../lib/madrid-status";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
};

export async function GET() {
  return Response.json(await getMadridStatus(), { headers: CACHE_HEADERS });
}
