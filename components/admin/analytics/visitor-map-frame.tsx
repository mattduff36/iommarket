"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function VisitorMapFrame({
  state,
  children,
}: {
  state: "loading" | "ready" | "error";
  children?: ReactNode;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <div
      className="relative h-80 overflow-hidden rounded-lg border border-border bg-graphite-900 shadow-low"
      role="region"
      aria-label="Visitor locations"
      aria-busy={state === "loading"}
    >
      <style>{`
        @keyframes analytics-map-shimmer {
          from { transform: translateX(-120%); }
          to { transform: translateX(280%); }
        }
        .visitor-map-popup .maplibregl-popup-content {
          background: var(--sem-bg-surfaceElevated);
          color: var(--sem-text-primary);
          border: 1px solid var(--sem-border-default);
          border-radius: 8px;
          padding: 8px 10px;
          box-shadow: var(--shadow-high);
        }
        .visitor-map-popup .maplibregl-popup-content p + p {
          margin-top: 2px;
          color: var(--sem-text-secondary);
          font-size: 12px;
        }
        .visitor-map-popup .maplibregl-popup-tip {
          border-top-color: var(--sem-bg-surfaceElevated);
        }
      `}</style>
      {children}
      {state === "ready" ? null : (
        <div className={cn("absolute inset-0 bg-graphite-900", state === "error" && "flex items-center justify-center px-6")}>
          {state === "loading" ? (
            <>
              <p className="sr-only">Loading visitor map</p>
              {reduceMotion ? null : (
                <div
                  className="absolute inset-y-0 left-0 w-1/2"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
                    animation: "analytics-map-shimmer 1.8s ease-in-out infinite",
                  }}
                />
              )}
            </>
          ) : (
            <p className="text-center text-sm text-text-secondary">
              The visitor map could not load. Country and city counts are still listed beside it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
