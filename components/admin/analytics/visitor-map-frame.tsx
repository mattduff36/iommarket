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
      className="visitor-map-frame relative min-h-80 flex-1 overflow-hidden rounded-lg border border-border bg-graphite-900 shadow-low"
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
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-group {
          background: #1c1c1e;
          border-radius: 8px;
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-group:not(:empty) {
          border: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: none;
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-group button + button {
          border-top-color: rgba(255, 255, 255, 0.14);
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-group button:hover {
          background-color: rgba(255, 255, 255, 0.08);
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(1);
        }
        .visitor-map-frame .maplibregl-ctrl-attrib:not(:hover):not(:focus-within) {
          width: 29px;
          height: 29px;
          min-height: 29px;
          padding: 0;
          overflow: hidden;
          border-radius: 8px;
        }
        .visitor-map-frame .maplibregl-ctrl-attrib:not(:hover):not(:focus-within) .maplibregl-ctrl-attrib-inner {
          display: none;
        }
        .visitor-map-frame .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button {
          display: block;
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-attrib {
          background-color: #1c1c1e;
          color: #c7c7cc;
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-attrib.maplibregl-compact,
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-attrib:not(:hover):not(:focus-within) {
          border: 1px solid rgba(255, 255, 255, 0.14);
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button {
          background-color: transparent;
          filter: invert(1);
        }
        [data-theme="dark"] .visitor-map-frame .maplibregl-ctrl-attrib a {
          color: #e8e8ed;
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
