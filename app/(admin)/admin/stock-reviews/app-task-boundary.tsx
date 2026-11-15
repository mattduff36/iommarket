"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
import { getWorkerDashboard } from "./worker-actions";
import { useStockAppLifecycle } from "./app-lifecycle";
import { StockWorkerControlProvider, useOptionalStockWorkerControl, useStockWorkerCommands } from "./worker-context";

/** Give stock actions outside the dashboard the same connection and launch confirmation. */
export function StockAppTaskBoundary({ children }: { children: ReactNode }) {
  const existing = useOptionalStockWorkerControl();
  return existing ? children : <StandaloneStockAppTasks>{children}</StandaloneStockAppTasks>;
}

function StandaloneStockAppTasks({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<WorkerDashboardResult | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    async function poll() {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await getWorkerDashboard();
        if (!stopped) { setSnapshot(next); setNow(Date.now()); }
      } catch { if (!stopped) setSnapshot({ ok: false, error: "unavailable" }); }
      finally { inFlight = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    const visible = () => { if (document.visibilityState !== "hidden") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  const devices = snapshot?.ok ? snapshot.devices : [];
  const device = devices.find(row => row.online && row.lastSeenAt && now - Date.parse(row.lastSeenAt) <= 35_000);
  const controls = useStockWorkerCommands(device, Boolean(device), setSnapshot);
  const connectedLaunch = devices.filter(row => row.launchId).sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))[0]?.launchId;
  const lifecycle = useStockAppLifecycle(controls, connectedLaunch);
  const value = { ...controls, requestRun: snapshot?.ok ? lifecycle.requestRun : undefined,
    pending: !snapshot || controls.pending || lifecycle.pending };
  return <StockWorkerControlProvider value={value}>
    {children}
    {!snapshot ? <p role="status" className="text-sm text-text-secondary">Checking Stock Update connection…</p> :
      !snapshot.ok ? <p role="status" className="text-sm text-text-secondary">Stock Update connection unavailable. Retrying…</p> : null}
    {lifecycle.message && <p role="status" className="text-sm text-text-secondary">{lifecycle.message}</p>}
    {controls.message && <p role="status" className="text-sm text-text-secondary">{controls.message}</p>}
    {lifecycle.launchFallback}
    {lifecycle.dialog}
  </StockWorkerControlProvider>;
}
