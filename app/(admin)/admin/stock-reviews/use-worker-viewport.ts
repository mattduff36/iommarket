"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Reserve a footer row inside the available viewport, rather than over the content. */
export function useWorkerViewport(connected: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!connected) return;
    const measure = () => {
      if (!ref.current) return;
      const top = Math.max(0, ref.current.getBoundingClientRect().top);
      setHeight(Math.max(0, window.innerHeight - top - 16));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ref.current?.parentElement) observer?.observe(ref.current.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [connected]);
  return { ref, height: connected ? height : undefined };
}
