import { recordVisitor } from "../../../../lib/visitor-analytics";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 16) {
    return Response.json(
      { error: "Payload too large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  const body = await request.text();
  if (body.length > 16) {
    return Response.json(
      { error: "Payload too large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  await recordVisitor(request).catch(() => {});
  return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
}
