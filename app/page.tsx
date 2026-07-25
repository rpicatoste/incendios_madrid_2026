import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "FOCO Madrid — Incendios y calidad del aire",
  description:
    "Mapa ciudadano de seguimiento de incendios, evacuaciones, confinamientos, calidad del aire y meteorología en la Comunidad de Madrid.",
};

export default function Home() {
  return <Dashboard />;
}
