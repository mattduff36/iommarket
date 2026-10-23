"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { WorkerDashboardDevice, WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
import { getWorkerDashboard } from "./worker-actions";
import { StockWorkerCompletion, stockJobFinished, stockJobOutcome } from "./worker-completion";
import { StockWorkerControlProvider, stockWorkerCommandClass, stockWorkerCommandLabel, useStockWorkerCommands } from "./worker-context";
import progressStyles from "./worker-progress.module.css";

export interface LiveStockJob { id: string; dealerName: string; kind: string; status: string; startedAt: string | null; reportStatus?: string | null }

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
  const [barHeight, setBarHeight] = useState(112);
  const bar = useRef<HTMLDivElement>(null);
  const devices = snapshot.ok ? snapshot.devices : [];
  const device = devices.find(row => row.deviceId === selected && fresh(row, now)) ?? devices.find(row => fresh(row, now)) ?? devices[0];
  const online = snapshot.ok && Boolean(device && fresh(device, now));
  const controls = useStockWorkerCommands(device, online, setSnapshot);
  const { pending, message, running } = controls;
  const activeJobs = jobs.filter(job => job.status === "LEASED");
  const queued = jobs.filter(job => job.status === "QUEUED").length;
  const active = activeJobs[0];
  const latestFinished = jobs.filter(stockJobFinished).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))[0];
  const phase = device?.activity.at(-1)?.text ?? "Connected and ready";
  const busy = activeJobs.length > 0 || (online && device?.state === "running");
  const title = !snapshot.ok ? "Connection status unavailable" : !online ? "Start the Stock Update worker app" :
    device?.state === "error" ? "Worker needs attention" : device?.state === "stopping" ? "Stopping after the current job" :
    active ? `${active.kind === "APPLY" ? "Applying" : "Scanning"} · ${active.dealerName}` :
    queued === 0 && latestFinished ? stockJobOutcome(latestFinished) :
    readyCount > 0 ? "Ready for review" : device?.state === "stopped" ? "Worker stopped" :
    running ? "Connected · waiting for queued work" : "Connected · ready to start";

  useEffect(() => {
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
    return () => { stopped = true; clearInterval(timer); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [router]);

  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setBarHeight(Math.ceil(element.getBoundingClientRect().height) + 24));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const buttons = <>
    <button type="button" onClick={() => controls.command(running ? "stop" : "start")}
      disabled={!controls.canCommand}
      className={stockWorkerCommandClass(running)}>
      {stockWorkerCommandLabel({ pending, pendingCommand: Boolean(device?.pendingCommand), stopping: device?.state === "stopping", running })}
    </button>
    <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="stock-worker-activity"
      className="min-h-10 rounded-md border border-border px-3 text-sm text-text-primary">{expanded ? "Hide activity" : "Show activity"}</button>
  </>;

  return <StockWorkerControlProvider value={controls}>
    <section aria-label="Worker connection" className="space-y-3 rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-neon-blue-400">Stock Update</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">{title}</h2></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${online ? "border-neon-blue-500/40 text-neon-blue-400" : "border-border text-text-secondary"}`}>{online ? "Connected" : snapshot.ok ? "Not connected" : "Unavailable"}</span>
      </div>
      <p className="text-sm text-text-secondary">{!snapshot.ok ? "Live status could not be loaded. Retrying automatically; check the app before starting more work." :
        !online ? "Open version 1.1.2 or later on your computer, click Sign in, and keep it open. This page will connect automatically." :
        `${device?.deviceName} · ${device?.environment === "preview" ? "Preview — itrader.dev" : "Production — itrader.im"}. Select dealers below, then start the worker. Selected dealers are queued as part of that start.`}</p>
      {online ? <>
      {devices.length > 1 ? <label className="block text-sm text-text-secondary">Computer <select disabled={pending} className="ml-2 rounded-md border border-border bg-surface p-2 text-text-primary" value={device?.deviceId ?? ""} onChange={event => setSelected(event.target.value)}>
        {devices.map(row => <option key={row.deviceId} value={row.deviceId}>{row.deviceName}{fresh(row, now) ? " — connected" : " — offline"}</option>)}
      </select></label> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary"><span>{queued} queued</span><span>{activeJobs.length} processing</span><a href="#stock-review-results" className="text-neon-blue-400 hover:underline">{readyCount} ready for review</a></div>
      <p className="text-xs text-text-tertiary">Updates automatically every few seconds. Reviews and approval stay under your control.</p>
      </> : null}
    </section>
    {children}
    <div aria-hidden="true" style={{ height: online ? barHeight : 0 }} />
    <div ref={bar} hidden={!online} data-stock-worker-dock="" className={`${progressStyles.dock} fixed inset-x-3 bottom-3 z-40 sm:inset-x-5 lg:left-72`}>
      <div aria-hidden="true" data-stock-worker-backdrop="" className={progressStyles.backdrop} />
      <div data-stock-worker-panel="" className={`${progressStyles.panel} overflow-hidden rounded-xl border border-neon-blue-500/40 bg-surface shadow-2xl`}>
      <div className="h-1 overflow-hidden bg-neon-blue-500/10" role={busy ? "progressbar" : undefined}
        aria-label={busy ? "Stock update in progress" : undefined} aria-hidden={busy ? undefined : true}>
        <div className={`h-full bg-neon-blue-500 ${busy ? progressStyles.moving : online ? "w-full opacity-40" : "w-0"}`} />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Image src="/images/logo-itrader-hq.png" alt="iTrader" width={220} height={74} className="mr-1 h-9 w-auto shrink-0" />
        <div className="min-w-0 flex-1"><p role="status" className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="text-xs text-text-secondary">{active ? elapsed(active.startedAt, now) : online && latestFinished && queued === 0 ? "No tasks running. Click Start worker to run queued work." : online ? phase : "Waiting for a connection"}{activeJobs.length > 1 ? ` · ${activeJobs.length} jobs processing` : ""}</p></div>
        <div className="flex flex-wrap gap-2">{buttons}</div>
      </div>
      {message ? <p role="status" className="px-4 pb-3 text-sm text-text-secondary">{message}</p> : null}
      {device?.pendingCommand ? <p className="px-4 pb-3 text-xs text-text-secondary">{device.pendingCommand.action === "start" ? "Start" : "Safe stop"} is awaiting acknowledgement from the app.</p> : null}
      {expanded ? <div id="stock-worker-activity" className="max-h-[35vh] overflow-y-auto border-t border-border px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">Recent worker activity</h3>
        {device?.activity.length ? <ol className="space-y-1 text-sm text-text-secondary">{device.activity.map(event => <li key={`${device.instanceId}:${event.sequence}`} className="flex gap-3"><time className="shrink-0 tabular-nums text-text-tertiary" dateTime={event.at}>{new Date(event.at).toLocaleTimeString("en-GB")}</time><span>{event.text}</span></li>)}</ol> : <p className="text-sm text-text-secondary">Activity will appear when the worker connects.</p>}
      </div> : null}
      </div>
    </div>
    <StockWorkerCompletion jobs={jobs} canShow={canRefreshStockPage} />
  </StockWorkerControlProvider>;
}
