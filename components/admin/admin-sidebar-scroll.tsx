"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function AdminSidebarScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // The site header scrolls away. Only the visible space below the sticky
      // menu's current top is available, not the whole viewport height.
      const top = Math.max(0, element.getBoundingClientRect().top);
      element.style.maxHeight = `${Math.max(0, window.innerHeight - top)}px`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className="sticky top-0 max-h-dvh overflow-y-auto overscroll-contain px-4 py-4 space-y-5">
      {children}
    </div>
  );
}
