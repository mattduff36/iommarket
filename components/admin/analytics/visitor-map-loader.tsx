"use client";

import dynamic from "next/dynamic";
import { VisitorMapFrame } from "@/components/admin/analytics/visitor-map-frame";
import type { VisitorMapPoint } from "@/components/admin/analytics/visitor-map-point";

const VisitorMap = dynamic(
  () => import("@/components/admin/analytics/visitor-map").then((module) => module.VisitorMap),
  { ssr: false, loading: () => <VisitorMapFrame state="loading" /> },
);

export function VisitorMapLoader({ points }: { points: VisitorMapPoint[] }) {
  return <VisitorMap points={points} />;
}
