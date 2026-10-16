"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Enhance rendered headers, including server-rendered and sortable columns.
 * Without JavaScript the ordinary semantic table remains scrollable.
 */
export function ResponsiveTableFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const labelRows = () => {
      const table = frame.querySelector("table");
      if (!table) return;
      const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);
      if (!headers.length || headers.some((cell) => cell.colSpan > 1)) return;
      for (const body of Array.from(table.tBodies)) {
        for (const row of Array.from(body.rows)) {
          let column = 0;
          for (const cell of Array.from(row.cells)) {
            const header = headers[column];
            // Full-width empty/detail rows must not acquire a misleading label.
            const label = cell.colSpan === 1 ? header?.textContent?.trim() : "";
            if (label) cell.dataset.label = label;
            else delete cell.dataset.label;
            column += cell.colSpan;
          }
        }
      }
      frame.dataset.ready = "true";
    };
    labelRows();
    const observer = new MutationObserver(labelRows);
    observer.observe(frame, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className="responsive-table-frame">{children}</div>;
}
