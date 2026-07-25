import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "FOCO Centro — Incendios y calidad del aire",
  description:
    "Mapa ciudadano de seguimiento de incendios, evacuaciones, confinamientos, calidad del aire y meteorología en Madrid y las comunidades limítrofes.",
};

export default function Home() {
  return <Dashboard />;
}
