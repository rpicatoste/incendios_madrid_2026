import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: "FOCO Centro — Incendios y calidad del aire",
      template: "%s · FOCO Centro",
    },
    description:
      "Mapa ciudadano de seguimiento de incendios, evacuaciones, confinamientos, calidad del aire y meteorología en Madrid y las comunidades limítrofes.",
    openGraph: {
      title: "FOCO Centro",
      description: "Incendios, avisos, aire, histórico y meteorología en un único mapa.",
      type: "website",
      locale: "es_ES",
      url: baseUrl,
      images: [`${baseUrl}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "FOCO Centro",
      description: "Incendios, avisos, aire, histórico y meteorología en un único mapa.",
      images: [`${baseUrl}/og.png`],
    },
    icons: {
      icon: "/favicon.svg",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
