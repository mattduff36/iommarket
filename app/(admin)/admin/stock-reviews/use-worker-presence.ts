"use client";
import { useEffect, useRef } from "react";
import type { WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";

/** Presence is independent of report refresh guards, so edits never hide an app exit. */
export function useWorkerPresence(update: (value: WorkerDashboardResult) => void, refresh: (() => void) | undefined) {
  const callbacks = useRef({ update, refresh });
  callbacks.current = { update, refresh };
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let lastState: string | null = null;
    const connect = () => {
      source?.close();
      source = null;
      if (document.visibilityState === "hidden") return;
      source = new EventSource("/api/admin/stock-reviews/presence");
      source.onmessage = event => {
        try {
          const value = JSON.parse(event.data) as WorkerDashboardResult;
          if (!value.ok || !Array.isArray(value.devices)) return;
          callbacks.current.update(value);
          const state = JSON.stringify(value.devices.map(device => [device.deviceId, device.instanceId, device.state, device.online]));
          if (lastState !== null && state !== lastState) callbacks.current.refresh?.();
          lastState = state;
        } catch { /* The ordinary snapshot poll remains the fallback. */ }
      };
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    return () => { source?.close(); document.removeEventListener("visibilitychange", connect); };
  }, []);
}
