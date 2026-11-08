"use client";

import { useEffect, type RefObject } from "react";
import { lockStockWorkerPage } from "./worker-page-lock-dom";

export function StockWorkerPageLock({ active, footer }: { active: boolean; footer: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    if (active && footer.current) return lockStockWorkerPage(footer.current);
  }, [active, footer]);
  return null;
}
