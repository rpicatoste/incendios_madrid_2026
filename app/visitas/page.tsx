import type { Metadata } from "next";
import VisitorAnalytics from "./VisitorAnalytics";

export const metadata: Metadata = {
  title: "Visitas privadas — FOCO Centro",
  robots: { index: false, follow: false },
};

export default function VisitorsPage() {
  return <VisitorAnalytics />;
}
