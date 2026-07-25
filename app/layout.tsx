import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: "FOCO Madrid — Incendios y calidad del aire",
      template: "%s · FOCO Madrid",
    },
    description:
      "Mapa ciudadano de seguimiento de incendios, evacuaciones, confinamientos, calidad del aire y meteorología en la Comunidad de Madrid.",
    openGraph: {
      title: "FOCO Madrid",
      description: "Incendios, avisos, aire y meteorología en un único mapa.",
      type: "website",
      locale: "es_ES",
      url: baseUrl,
      images: [`${baseUrl}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "FOCO Madrid",
      description: "Incendios, avisos, aire y meteorología en un único mapa.",
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
