"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Toast, ToastDescription, ToastProvider, ToastViewport } from "@/components/ui/toast";
import { lockStockWorkerPage } from "./worker-page-lock-dom";

export function StockWorkerPageLock({ active, footer }: { active: boolean; footer: RefObject<HTMLElement | null> }) {
  const [warningHost, setWarningHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !footer.current) return;
    const viewport = document.createElement("div");
    viewport.dataset.stockWorkerWarningViewport = "";
    viewport.style.cssText = "position:fixed;top:0;right:0;width:min(100%,420px);overflow:hidden;pointer-events:none;z-index:2147483647;";
    document.body.append(viewport);
    let timer: number | undefined;
    const release = lockStockWorkerPage(footer.current, {
      warningViewport: viewport,
      onBlockedClick: () => {
        window.clearTimeout(timer);
        setWarningHost(viewport);
        // Own the deadline so Radix hover/focus pauses cannot extend this noninteractive notice.
        timer = window.setTimeout(() => { setWarningHost(null); timer = undefined; }, 3000);
      },
    });
    return () => {
      window.clearTimeout(timer);
      release();
      viewport.remove();
      setWarningHost(null);
    };
  }, [active, footer]);
  if (!active || !warningHost) return null;
  return createPortal(<ToastProvider duration={Infinity} label="Stock update">
    <Toast open variant="default" type="background" tabIndex={-1} data-stock-worker-warning=""
      style={{ pointerEvents: "none" }} className="border-status-warning-text/40 bg-surface text-status-warning-text">
      <ToastDescription>Stock update is running. You can scroll to view progress; use STOP in the footer to stop the worker.</ToastDescription>
    </Toast>
    <ToastViewport hotkey={[]} tabIndex={-1} label="Stock update notice"
      style={{ position: "relative", pointerEvents: "none" }} />
  </ToastProvider>, warningHost);
}
