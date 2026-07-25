import {
  analyticsTokenIsValid,
  getAnalyticsSummary,
} from "../../../lib/visitor-analytics";

const notFound = () =>
  Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 512) return notFound();
    const rawBody = await request.text();
    if (rawBody.length > 512) return notFound();
    const body = JSON.parse(rawBody || "{}") as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!analyticsTokenIsValid(token)) return notFound();
    return Response.json(await getAnalyticsSummary(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return notFound();
  }
}

export async function GET() {
  return notFound();
}
