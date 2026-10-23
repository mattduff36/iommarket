"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
import { commandWorker, getWorkerDashboard } from "./worker-actions";

export type StockWorkerCommandAction = "start" | "stop";
export type StockWorkerCommandOutcome = "ok" | "failed" | "uncertain" | "skipped";

export type StockWorkerControlDevice = {
  deviceId: string;
  instanceId: string | null;
  state: string | null;
  pendingCommand: { action: StockWorkerCommandAction } | null;
};

export type StockWorkerControl = {
  online: boolean;
  running: boolean;
  pending: boolean;
  stopping: boolean;
  canCommand: boolean;
  pendingCommand: { action: StockWorkerCommandAction } | null;
  message: string;
  tryAcquire: () => boolean;
  release: () => void;
  dispatch: (action: StockWorkerCommandAction) => Promise<StockWorkerCommandOutcome>;
  command: (action: StockWorkerCommandAction) => void;
};

const StockWorkerControlContext = createContext<StockWorkerControl | null>(null);

export function stockWorkerIsRunning(online: boolean, state: string | null | undefined) {
  return online && (state === "running" || state === "waiting" || state === "stopping");
}

export function stockWorkerCommandLabel(input: { pending: boolean; pendingCommand: boolean; stopping: boolean; running: boolean }) {
  if (input.pending) return "Sending request…";
  if (input.pendingCommand) return "Waiting for app…";
  if (input.stopping) return "Stopping…";
  return input.running ? "Stop safely" : "Start worker";
}

export function stockWorkerCommandClass(running: boolean) {
  return `min-h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50 ${running ? "bg-neon-red-500" : "bg-neon-blue-500"}`;
}

export function StockWorkerControlProvider({ value, children }: { value: StockWorkerControl; children: ReactNode }) {
  return <StockWorkerControlContext.Provider value={value}>{children}</StockWorkerControlContext.Provider>;
}

export function useStockWorkerControl() {
  const value = useContext(StockWorkerControlContext);
  if (!value) throw new Error("Stock worker controls are available inside the stock reviews dashboard.");
  return value;
}

export function useStockWorkerCommands(
  device: StockWorkerControlDevice | undefined,
  online: boolean,
  setSnapshot: (value: WorkerDashboardResult) => void,
) {
  const lock = useRef(false);
  const mounted = useRef(true);
  const deviceRef = useRef(device);
  const onlineRef = useRef(online);
  const snapshotRef = useRef(setSnapshot);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  deviceRef.current = device;
  onlineRef.current = online;
  snapshotRef.current = setSnapshot;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const stopping = device?.state === "stopping";
  const pendingCommand = device?.pendingCommand ?? null;
  const running = stockWorkerIsRunning(online, device?.state);
  const canCommand = online && Boolean(device?.instanceId) && !pending && !pendingCommand && !stopping;

  function blocked() {
    const current = deviceRef.current;
    return lock.current || !onlineRef.current || !current?.instanceId || Boolean(current.pendingCommand) || current.state === "stopping";
  }

  function release() {
    lock.current = false;
    if (mounted.current) setPending(false);
  }

  async function dispatch(action: StockWorkerCommandAction): Promise<StockWorkerCommandOutcome> {
    const current = deviceRef.current;
    if (!mounted.current) return "skipped";
    if (!current?.instanceId || !onlineRef.current) {
      setMessage("The app is no longer connected. Reopen it and sign in.");
      return "skipped";
    }
    try {
      const result = await commandWorker({ deviceId: current.deviceId, instanceId: current.instanceId, action });
      if (!mounted.current) return result.ok ? "ok" : "failed";
      setMessage(result.ok ? "" :
        result.error === "conflict" ? "The app is no longer connected. Reopen it and sign in." : "The request was not accepted. Check the connection and try again.");
      const next = await getWorkerDashboard();
      if (mounted.current) snapshotRef.current(next);
      return result.ok ? "ok" : "failed";
    } catch {
      if (mounted.current) setMessage("The request outcome is uncertain. Check the worker state before trying again.");
      return "uncertain";
    }
  }

  function tryAcquire() {
    if (blocked()) return false;
    lock.current = true;
    setPending(true);
    setMessage("");
    return true;
  }

  function command(action: StockWorkerCommandAction) {
    if (blocked()) return;
    lock.current = true;
    setPending(true);
    setMessage("");
    void (async () => {
      try { await dispatch(action); }
      finally { release(); }
    })();
  }

  return { online, running, pending, stopping, canCommand, pendingCommand, message, tryAcquire, release, dispatch, command };
}
