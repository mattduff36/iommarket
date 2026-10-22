"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { WorkerDashboardDevice, WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
import { commandWorker, getWorkerDashboard } from "./worker-actions";

export interface LiveStockJob { id: string; dealerName: string; kind: string; status: string; startedAt: string | null }

export function canRefreshStockPage() {
  const focus = document.activeElement;
  return document.visibilityState !== "hidden" && !document.querySelector('[role="dialog"],dialog[open],[data-stock-review-editing="true"]') &&
    !(focus instanceof HTMLElement && (focus.matches('input:not([type="checkbox"]),textarea,select,[contenteditable="true"]')));
}

function elapsed(start: string | null, now: number) {
  if (!start || !Number.isFinite(Date.parse(start))) return "";
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function fresh(device: WorkerDashboardDevice, now: number) {
  return device.online && device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) <= 35_000;
}

export function StockWorkerDashboard({ initial, jobs, readyCount, children, initialNow = 0 }: {
  initialNow?: number; initial: WorkerDashboardResult; jobs: LiveStockJob[]; readyCount: number; children?: ReactNode;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(initialNow);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [barHeight, setBarHeight] = useState(112);
  const bar = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const devices = snapshot.ok ? snapshot.devices : [];
  const device = devices.find(row => row.deviceId === selected) ?? devices.find(row => fresh(row, now)) ?? devices[0];
  const online = snapshot.ok && Boolean(device && fresh(device, now));
  const running = online && (device?.state === "running" || device?.state === "waiting" || device?.state === "stopping");
  const activeJobs = jobs.filter(job => job.status === "LEASED");
  const queued = jobs.filter(job => job.status === "QUEUED").length;
  const active = activeJobs[0];
  const phase = device?.activity.at(-1)?.text ?? "Connected and ready";
  const busy = activeJobs.length > 0 || (online && device?.state === "running");
  const title = !snapshot.ok ? "Connection status unavailable" : !online ? "Start the Stock Update worker app" :
    device?.state === "error" ? "Worker needs attention" : device?.state === "stopping" ? "Stopping after the current job" :
    active ? `${active.kind === "APPLY" ? "Applying" : "Scanning"} · ${active.dealerName}` :
    readyCount > 0 ? "Ready for review" : device?.state === "stopped" ? "Worker stopped" :
    running ? "Connected · waiting for queued work" : "Connected · ready to start";

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let inFlight = false;
    async function poll() {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await getWorkerDashboard();
        if (!stopped) setSnapshot(next);
      } catch { if (!stopped) setSnapshot({ ok: false, error: "unavailable" }); }
      finally {
        inFlight = false;
        // refresh merges server results without clearing client selections or scroll.
        if (!stopped && canRefreshStockPage()) router.refresh();
      }
    }
    const timer = window.setInterval(() => void poll(), 5_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const visible = () => { if (document.visibilityState !== "hidden") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; mounted.current = false; clearInterval(timer); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [router]);

  useEffect(() => {
    if (!bar.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => setBarHeight(Math.ceil(entries[0]?.contentRect.height ?? 112) + 32));
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);

  async function command(action: "start" | "stop") {
    if (!device?.instanceId || !online || pending) return;
    setPending(true); setMessage("");
    try {
      const result = await commandWorker({ deviceId: device.deviceId, instanceId: device.instanceId, action });
      if (!mounted.current) return;
      setMessage(result.ok ? `${action === "start" ? "Start" : "Safe stop"} requested. The current worker state is shown above.` :
        result.error === "conflict" ? "The app is no longer connected. Reopen it and sign in." : "The request was not accepted. Check the connection and try again.");
      setSnapshot(await getWorkerDashboard());
    } catch { if (mounted.current) setMessage("The request outcome is uncertain. Check the worker state before trying again."); }
    finally { if (mounted.current) setPending(false); }
  }

  const buttons = <>
    <button type="button" onClick={() => void command(running ? "stop" : "start")}
      disabled={!online || pending || Boolean(device?.pendingCommand) || device?.state === "stopping"}
      className="min-h-10 rounded-md bg-neon-blue-500 px-4 text-sm font-semibold text-white disabled:opacity-50">
      {device?.state === "stopping" ? "Stopping…" : running ? "Stop safely" : "Start worker"}
    </button>
    <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="stock-worker-activity"
      className="min-h-10 rounded-md border border-border px-3 text-sm text-text-primary">{expanded ? "Hide activity" : "Show activity"}</button>
  </>;

  return <>
    <section aria-label="Worker connection" className="space-y-3 rounded-xl border border-border bg-surface-secondary p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-neon-blue-400">Stock Update</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">{title}</h2></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${online ? "border-neon-blue-500/40 text-neon-blue-400" : "border-border text-text-secondary"}`}>{online ? "Connected" : snapshot.ok ? "Not connected" : "Unavailable"}</span>
      </div>
      <p className="text-sm text-text-secondary">{!snapshot.ok ? "Live status could not be loaded. Retrying automatically; check the app before starting more work." :
        !online ? "Open version 1.1.2 or later on your computer, click Sign in, and keep it open. This page will connect automatically." :
        `${device?.deviceName} · ${device?.environment === "preview" ? "Preview — itrader.dev" : "Production — itrader.im"}. Choose dealers below, then start the worker here.`}</p>
      {devices.length > 1 ? <label className="block text-sm text-text-secondary">Computer <select className="ml-2 rounded-md border border-border bg-surface-primary p-2 text-text-primary" value={device?.deviceId ?? ""} onChange={event => setSelected(event.target.value)}>
        {devices.map(row => <option key={row.deviceId} value={row.deviceId}>{row.deviceName}{fresh(row, now) ? " — connected" : " — offline"}</option>)}
      </select></label> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary"><span>{queued} queued</span><span>{activeJobs.length} processing</span><a href="#stock-review-results" className="text-neon-blue-400 hover:underline">{readyCount} ready for review</a></div>
      <p className="text-xs text-text-tertiary">Updates automatically every few seconds. Reviews and approval stay under your control.</p>
    </section>
    {children}
    <div aria-hidden="true" style={{ height: barHeight }} />
    <div ref={bar} className="fixed inset-x-3 bottom-3 z-40 overflow-hidden rounded-xl border border-neon-blue-500/40 bg-surface-primary shadow-2xl sm:inset-x-5 lg:left-72">
      <div className="h-1 bg-neon-blue-500/10" aria-hidden="true"><div className={`h-full bg-neon-blue-500 ${busy ? "w-1/3 motion-safe:animate-pulse" : online ? "w-full opacity-40" : "w-0"}`} /></div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="mr-1 text-xl font-bold tracking-tight text-neon-blue-400">iTrader<span className="font-normal text-text-primary">.</span></span>
        <div className="min-w-0 flex-1"><p role="status" className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="text-xs text-text-secondary">{active ? elapsed(active.startedAt, now) : online ? phase : "Waiting for a connection"}{activeJobs.length > 1 ? ` · ${activeJobs.length} jobs processing` : ""}</p></div>
        <div className="flex flex-wrap gap-2">{buttons}</div>
      </div>
      {message ? <p role="status" className="px-4 pb-3 text-sm text-text-secondary">{message}</p> : null}
      {device?.pendingCommand ? <p className="px-4 pb-3 text-xs text-text-secondary">{device.pendingCommand.action === "start" ? "Start" : "Safe stop"} is awaiting acknowledgement from the app.</p> : null}
      {expanded ? <div id="stock-worker-activity" className="max-h-[35vh] overflow-y-auto border-t border-border px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">Recent worker activity</h3>
        {device?.activity.length ? <ol className="space-y-1 text-sm text-text-secondary">{device.activity.map(event => <li key={`${device.instanceId}:${event.sequence}`} className="flex gap-3"><time className="shrink-0 tabular-nums text-text-tertiary" dateTime={event.at}>{new Date(event.at).toLocaleTimeString("en-GB")}</time><span>{event.text}</span></li>)}</ol> : <p className="text-sm text-text-secondary">Activity will appear when the worker connects.</p>}
      </div> : null}
    </div>
  </>;
}
