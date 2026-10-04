"use client";

import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { VisitorMapFrame } from "@/components/admin/analytics/visitor-map-frame";
import type { VisitorMapPoint } from "@/components/admin/analytics/visitor-map-point";
import { cn } from "@/lib/cn";

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";

function popupContent(city: string, country: string, count: number) {
  const content = document.createElement("div");
  const title = document.createElement("p");
  title.textContent = `${city}, ${country}`;
  const detail = document.createElement("p");
  detail.textContent = `${count.toLocaleString("en-GB")} consented users`;
  content.append(title, detail);
  return content;
}

function placeDots(map: MapLibreMap, points: VisitorMapPoint[]) {
  map.addSource("visitors", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        properties: { city: point.city, country: point.country, count: point.count },
      })),
    },
  });
  map.addLayer({
    id: "visitor-dots",
    type: "circle",
    source: "visitors",
    paint: {
      "circle-color": "#0085FF",
      "circle-opacity": 0.82,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#33A3FF",
      "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "count"]], 1, 5, 12, 18],
    },
  });
  if (points.length === 1) {
    const only = points[0];
    if (only) map.jumpTo({ center: [only.longitude, only.latitude], zoom: 4 });
    return;
  }
  if (points.length > 1) {
    const bounds = new LngLatBounds();
    for (const point of points) bounds.extend([point.longitude, point.latitude]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 5, duration: 0 });
  }
}

export function VisitorMap({ points }: { points: VisitorMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let ready = false;
    const theme = document.documentElement.getAttribute("data-theme");
    // Turbopack cannot preserve MapLibre's worker-relative import.meta.url
    // lookup. Use the same-origin copy prepared from the installed package.
    setWorkerUrl(WORKER_URL);
    const map = new MapLibreMap({
      container,
      style: theme === "light" ? LIGHT_STYLE : DARK_STYLE,
      center: [-4.48, 54.15],
      zoom: 1.3,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "visitor-map-popup",
    });

    const onLoad = () => {
      ready = true;
      placeDots(map, points);
      map.on("mousemove", "visitor-dots", (event: MapLayerMouseEvent) => {
        const properties = event.features?.[0]?.properties;
        if (!properties) return;
        map.getCanvas().style.cursor = "pointer";
        const count = Number(properties.count);
        popup
          .setLngLat(event.lngLat)
          .setDOMContent(popupContent(String(properties.city), String(properties.country), Number.isFinite(count) ? count : 0))
          .addTo(map);
      });
      map.on("mouseleave", "visitor-dots", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      setState("ready");
    };
    const onError = (event: { error?: { message?: string } }) => {
      const message = event.error?.message ?? "";
      if (!ready && /style|ajax|fetch|network|failed/i.test(message)) setState("error");
    };

    map.on("load", onLoad);
    map.on("error", onError);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);
    return () => {
      ready = true;
      resize.disconnect();
      popup.remove();
      map.remove();
    };
  }, [points]);

  return (
    <VisitorMapFrame state={state}>
      <div
        ref={containerRef}
        className={cn(
          "h-full w-full motion-reduce:transition-none",
          state === "ready" ? "opacity-100 transition-opacity duration-300" : "opacity-0",
        )}
      />
    </VisitorMapFrame>
  );
}
