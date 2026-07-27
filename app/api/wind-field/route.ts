import { getWindField } from "../../../lib/wind-field";

export async function GET() {
  try {
    const field = await getWindField();
    const remainingSeconds = Math.max(
      0,
      Math.floor((Date.parse(field.expiresAt) - Date.now()) / 1000),
    );
    return Response.json(field, {
      headers: {
        "Cache-Control": field.stale
          ? "public, max-age=300, must-revalidate"
          : `public, max-age=${remainingSeconds}, must-revalidate`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Campo de viento no disponible" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
