"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { launchStockApp } from "./launch-actions";
import { openStockUpdateProtocol } from "./app-launch-navigation";
import type { StockWorkerControl } from "./worker-context";

export type StockAppTask = () => Promise<string[]>;
export type StockAppRun = (task: StockAppTask) => Promise<void>;

/** Confirmation happens before the action queues anything. A task is never replayed. */
export function useStockAppLifecycle(controls: StockWorkerControl, connectedLaunchId?: string | null, allowWindowsLaunch = true) {
  const current = useRef(controls);
  current.current = controls;
  const windowsAllowed = useRef(allowWindowsLaunch);
  windowsAllowed.current = allowWindowsLaunch;
  const locked = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [launchFailed, setLaunchFailed] = useState(false);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ task: StockAppTask; resolve: () => void } | null>(null);
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; confirmationRef.current?.resolve(); };
  }, []);
  useEffect(() => {
    if (controls.online) setLaunchFailed(false);
  }, [controls.online]);
  useEffect(() => {
    if (!launchId) return;
    if (connectedLaunchId === launchId) {
      setLaunchFailed(false);
      setLaunchId(null);
      setLaunchUrl(null);
      setMessage("Stock Update received the request. Check task results below.");
      return;
    }
    const timeout = window.setTimeout(() => {
      setLaunchFailed(true);
      setLaunchId(null);
      setLaunchUrl(null);
      setMessage("The app has not connected. Allow the browser’s Open Stock Update prompt and install the latest app if needed. Any queued tasks are saved; check their status before trying again.");
    }, 45_000);
    return () => clearTimeout(timeout);
  }, [launchId, connectedLaunchId]);

  async function launch(mode: "open" | "task", jobIds: string[] = []) {
    if (!windowsAllowed.current) throw new Error("Windows fallback unavailable");
    setLaunchFailed(false);
    const result = await launchStockApp({ mode, jobIds });
    if (!result.ok) throw new Error(result.error);
    if (!mounted.current || !windowsAllowed.current) return;
    setLaunchId(result.launchId);
    setLaunchUrl(result.url);
    setMessage("Opening Stock Update. Allow the browser prompt if it appears.");
    openStockUpdateProtocol(result.url);
  }
  async function execute(task: StockAppTask, temporary: boolean) {
    const target = current.current.target;
    const wasRunning = current.current.running;
    const scopedVm = current.current.scopedVm;
    setPending(true);
    setMessage("");
    try {
      const ids = await task();
      if (!ids.length) return;
      if (temporary) await launch("task", ids);
      else if (!wasRunning) {
        const outcome = scopedVm ? await current.current.dispatch("start", target, ids) : await current.current.dispatch("start", target);
        if (outcome !== "ok") setMessage("Tasks are queued, but the app did not confirm starting. Check its connection before retrying.");
      }
    } catch {
      if (mounted.current) setMessage("The request could not be completed. Check the saved task status before trying again.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const requestRun: StockAppRun = async task => {
    if (locked.current || current.current.pending || current.current.stopping) return;
    if (!current.current.online && !windowsAllowed.current) return;
    if (current.current.scopedVm && !current.current.online) {
      setMessage("The selected Oracle VM is offline. Reconnect it or select another computer.");
      return;
    }
    if (current.current.scopedVm && current.current.running) {
      setMessage("The VM is processing a task. Wait for it to finish before starting another.");
      return;
    }
    locked.current = true;
    if (current.current.online) { await execute(task, false); return; }
    await new Promise<void>(resolve => setConfirmation({ task, resolve }));
  };
  function cancel() {
    confirmationRef.current?.resolve();
    confirmationRef.current = null;
    setConfirmation(null);
    locked.current = false;
  }
  async function confirm() {
    const request = confirmationRef.current;
    if (!request) return;
    confirmationRef.current = null;
    setConfirmation(null);
    try {
      if (windowsAllowed.current) await execute(request.task, !current.current.online);
    } finally { locked.current = false; request.resolve(); }
  }
  async function open() {
    if (locked.current || !windowsAllowed.current) return;
    locked.current = true;
    setPending(true);
    try { await launch("open"); }
    catch {
      setLaunchId(null);
      setLaunchUrl(null);
      setLaunchFailed(true);
      setMessage("Could not open Stock Update. Install the latest app and try again.");
    }
    finally { locked.current = false; if (mounted.current) setPending(false); }
  }
  useEffect(() => {
    if (!allowWindowsLaunch && confirmationRef.current) cancel();
  }, [allowWindowsLaunch]);
  const dialog = <Dialog open={confirmation !== null && allowWindowsLaunch} onOpenChange={value => { if (!value) cancel(); }}>
    <DialogContent>
      <DialogTitle>Start Stock Update for this task?</DialogTitle>
      <DialogDescription className="mt-3">This task needs the installed Stock Update app. It will connect to this site with your admin sign-in, run minimised, and close after these tasks finish. An app you already opened will stay open.</DialogDescription>
      <p className="mt-2 text-sm text-text-secondary">Your browser may ask permission to open the app.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button type="button" className="min-h-11 rounded-md border border-border px-4" onClick={cancel}>Cancel</button>
        <button type="button" className="min-h-11 rounded-md bg-neon-blue-600 px-4 text-white" onClick={() => void confirm()}>Start app and continue</button>
      </div>
    </DialogContent>
  </Dialog>;
  const launchFallback = launchUrl ? <button type="button" className="min-h-11 rounded-md border border-neon-blue-400 px-4 text-sm text-neon-blue-400" onClick={() => openStockUpdateProtocol(launchUrl)}>Open app if it did not start</button> : null;
  return { requestRun, open, pending: pending || launchId !== null, message, dialog, launchFallback, launchFailed };
}
