"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { canRefreshStockPage } from "./refresh-guard";
export { canRefreshStockPage } from "./refresh-guard";
import { StockWorkerCommandButton } from "./worker-command-button";
import type { WorkerDashboardDevice, WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
import { getWorkerDashboard } from "./worker-actions";
import { StockWorkerCompletion, stockJobFinished, stockJobOutcome } from "./worker-completion";
import { StockWorkerControlProvider, stockWorkerIsRunning, useStockWorkerCommands } from "./worker-context";
import { StockWorkerPageLock } from "./worker-page-lock";
import { StockDealerSelectionProvider, useDealerSelection, type StockDealer } from "./worker-selection";
import progressStyles from "./worker-progress.module.css";
import { useStockAppLifecycle } from "./app-lifecycle";
import { useWorkerViewport } from "./use-worker-viewport";
import { useWorkerPresence } from "./use-worker-presence";
import { useStockSnapshotRefresh } from "./use-stock-snapshot";

export interface LiveStockJob { id: string; dealerName: string; kind: string; status: string; startedAt: string | null; reportStatus?: string | null; reviewListingCount?: number | null }


function elapsed(start: string | null, now: number) {
  if (!start || !Number.isFinite(Date.parse(start))) return "";
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function fresh(device: WorkerDashboardDevice, now: number) {
  return device.online && device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) <= 35_000;
}

export function StockWorkerDashboard({ initial, jobs, readyCount, children, header, dealers = [], offlineContent, downloadFallback, initialNow = 0, managedSnapshot = false, connectionLost = false }: {
  managedSnapshot?: boolean; connectionLost?: boolean;
  dealers?: StockDealer[]; offlineContent?: ReactNode; downloadFallback?: ReactNode; initialNow?: number; initial: WorkerDashboardResult; jobs: LiveStockJob[]; readyCount: number; children?: ReactNode; header?: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const lastAvailable = useRef(initial);
  useEffect(() => { if (snapshot.ok) lastAvailable.current = snapshot; }, [snapshot]);
  const visibleSnapshot = snapshot.ok ? snapshot : managedSnapshot && connectionLost ? lastAvailable.current : snapshot;
  const [now, setNow] = useState(initialNow);
  const mergeSnapshot = (next: WorkerDashboardResult) => setSnapshot(previous => {
    if (!previous.ok || !next.ok) return next;
    return { ...next, devices: next.devices.map(row => {
      const old = previous.devices.find(device => device.deviceId === row.deviceId);
      return old?.lastSeenAt && (!row.lastSeenAt || Date.parse(old.lastSeenAt) > Date.parse(row.lastSeenAt)) ? old : row;
    }) };
  });
  useEffect(() => { if (managedSnapshot) mergeSnapshot(initial); }, [initial, managedSnapshot]);
  const refresh = useStockSnapshotRefresh();
  useWorkerPresence(value => { mergeSnapshot(value); setNow(Date.now()); }, refresh);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const devices = visibleSnapshot.ok ? visibleSnapshot.devices : [];
  const device = devices.find(row => row.deviceId === selected && fresh(row, now)) ?? devices.find(row => fresh(row, now)) ?? devices[0];
  const online = visibleSnapshot.ok && Boolean(device && (connectionLost ? device.online : fresh(device, now)));
  const baseControls = useStockWorkerCommands(device, online && !connectionLost, mergeSnapshot);
  const lifecycle = useStockAppLifecycle(baseControls, devices.filter(row => row.launchId).sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))[0]?.launchId);
  const controls = { ...baseControls, requestRun: connectionLost ? undefined : lifecycle.requestRun, pending: baseControls.pending || lifecycle.pending };
  const { pending, message, running } = controls;
  const activeJobs = jobs.filter(job => job.status === "LEASED");
  const pageLocked = activeJobs.length > 0 || stockWorkerIsRunning(online, device?.state);
  const dockVisible = online || pageLocked;
  const viewport = useWorkerViewport(dockVisible);
  const footer = useRef<HTMLElement>(null);
  const queued = jobs.filter(job => job.status === "QUEUED").length;
  const selection = useDealerSelection(dealers, controls, queued > 0, jobs.filter(job => job.status === "QUEUED").map(job => job.id));
  const active = activeJobs[0];
  const latestFinished = jobs.filter(stockJobFinished).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))[0];
  const phase = device?.activity.at(-1)?.text ?? "Connected and ready";
  const busy = activeJobs.length > 0 || (online && device?.state === "running");
  const title = connectionLost ? "Updates paused — reconnecting" : !snapshot.ok ? "Connection status unavailable" : !online ? "Start the Stock Update worker app" :
    device?.state === "error" ? "Worker needs attention" : device?.state === "stopping" ? "Stopping after the current job" :
    active ? `${active.kind === "APPLY" ? "Applying" : "Scanning"} · ${active.dealerName}` :
    queued === 0 && latestFinished ? stockJobOutcome(latestFinished) :
    readyCount > 0 ? "Ready for review" : device?.state === "stopped" ? "Worker stopped" :
    running ? "Connected · waiting for queued work" : "Connected · ready to start";

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    async function poll() {
      if (managedSnapshot || stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await getWorkerDashboard();
        if (!stopped) setSnapshot(next);
      } catch { if (!stopped) setSnapshot({ ok: false, error: "unavailable" }); }
      finally {
        inFlight = false;
      }
    }
    const timer = window.setInterval(() => void poll(), 5_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const visible = () => { if (document.visibilityState !== "hidden") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [managedSnapshot]);

  const compact = online && !connectionLost && !busy && !running && !pending && !device?.pendingCommand
    && device?.state !== "error" && !message && !expanded;

  const buttons = <>
    <StockWorkerCommandButton running={running} pending={pending} pendingCommand={Boolean(device?.pendingCommand)}
      stopping={device?.state === "stopping"} disabled={!selection.canAct} onClick={selection.startOrStop} iconOnly />
    {!compact && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="stock-worker-activity"
      className="min-h-11 rounded-md border border-border px-3 text-sm text-text-primary hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-blue-400">{expanded ? "Hide activity" : "Show activity"}</button>}
  </>;

  return <StockWorkerControlProvider value={controls}><StockDealerSelectionProvider value={selection}>
    {/* Keep document height stable as the navbar scrolls out and the inner viewport expands. */}
    <div className={dockVisible ? "min-h-[calc(100dvh-1rem)]" : undefined}>
    <div ref={viewport.ref} style={{ height: viewport.height }} className={dockVisible ? "flex min-h-0 flex-col" : undefined}>
    <div data-stock-worker-content="" style={dockVisible ? { containerType: "size" } : undefined} className={dockVisible ? "min-h-0 flex-1 space-y-8 overflow-y-auto pr-2 pb-6" : "space-y-8"}>
    {header}
    {!online ? offlineContent : null}
    <section aria-label="Worker connection" className="space-y-3 rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-text-primary">{title}</h2></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${online ? "border-neon-blue-500/40 text-neon-blue-400" : "border-border text-text-secondary"}`}>{connectionLost ? "Reconnecting" : online ? "Connected" : snapshot.ok ? "Not connected" : "Unavailable"}</span>
      </div>
      <p className="text-sm text-text-secondary">{!snapshot.ok ? "Retrying connection. Check the app before starting more work." :
        !online ? "Open Stock Update to connect to this site automatically." :
        `${device?.deviceName} · ${device?.environment === "preview" ? "Preview — itrader.dev" : "Production — itrader.im"}`}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending || connectionLost} onClick={() => void lifecycle.open()} className="min-h-11 rounded-md border border-neon-blue-400 px-4 text-sm text-neon-blue-400 disabled:opacity-50">Open Stock Update</button>
        {online ? <button type="button" disabled={!controls.canCommand || pending} onClick={() => controls.command("close")} className="min-h-11 rounded-md border border-border px-4 text-sm text-text-primary disabled:opacity-50">Close app safely</button> : null}
      </div>
      {lifecycle.message ? <p role="status" className="text-sm text-text-secondary">{lifecycle.message}</p> : null}
      {lifecycle.launchFallback}
      {!online && lifecycle.launchFailed ? downloadFallback : null}
      {message && !online ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
      {online ? <>
      {devices.length > 1 ? <label className="block text-sm text-text-secondary">Computer <select disabled={pending} className="ml-2 rounded-md border border-border bg-surface p-2 text-text-primary" value={device?.deviceId ?? ""} onChange={event => setSelected(event.target.value)}>
        {devices.map(row => <option key={row.deviceId} value={row.deviceId}>{row.deviceName}{fresh(row, now) ? " — connected" : " — offline"}</option>)}
      </select></label> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary"><span>{queued} queued</span><span>{activeJobs.length} processing</span><a href="#stock-review-results" className="text-neon-blue-400 hover:underline">{readyCount} ready for review</a></div>
      {queued > 0 && !running ? <p className="text-sm text-text-secondary">Queued work is ready. Click Start worker without selecting dealers to process it; select dealers only for new scans.</p> : null}
      </> : null}
    </section>
    {children}
    </div>
    <footer ref={footer} aria-label="Stock Update" hidden={!dockVisible} data-stock-worker-dock="" data-compact={compact} className="shrink-0 border-t-2 border-neon-blue-500/70 bg-canvas pb-[env(safe-area-inset-bottom)] text-text-secondary">
      <div className="h-0.5 overflow-hidden" role={busy ? "progressbar" : undefined}
        aria-label={busy ? "Stock update in progress" : undefined} aria-hidden={busy ? undefined : true}>
        <div className={`h-full bg-neon-blue-500 ${busy ? progressStyles.moving : "w-0"}`} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
        <button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? "Hide worker activity" : "Show worker activity"}
          aria-expanded={expanded} aria-controls="stock-worker-activity" title={title}
          className="flex min-h-11 shrink-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-blue-400">
          <span className="text-sm font-medium text-text-secondary">Stock Update</span>
        </button>
        <div className="min-w-0 flex-1"><p role="status" className="text-sm text-text-secondary">{title}</p>
          <p className="text-xs text-text-secondary">{active ? elapsed(active.startedAt, now) : online && latestFinished && queued === 0 ? "Run complete. Review the results above." : online ? phase : "Waiting for a connection"}{activeJobs.length > 1 ? ` · ${activeJobs.length} jobs processing` : ""}</p></div>
        <div data-stock-worker-commands="" className="flex flex-wrap gap-2">{buttons}</div>
      </div>
      {message ? <p role="status" className="px-4 pb-3 text-sm text-text-secondary">{message}</p> : null}
      {device?.pendingCommand ? <p className="px-4 pb-3 text-xs text-text-secondary">{device.pendingCommand.action === "start" ? "Start" : device.pendingCommand.action === "close" ? "Close app" : "Safe stop"} is awaiting acknowledgement from the app.</p> : null}
      {expanded ? <div id="stock-worker-activity" className="max-h-[35vh] overflow-y-auto border-t border-border px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">Recent worker activity</h3>
        {device?.activity.length ? <ol className="space-y-1 text-sm text-text-secondary">{[...device.activity].reverse().map(event => <li key={`${device.instanceId}:${event.sequence}`} className="flex gap-3"><time className="shrink-0 tabular-nums text-text-tertiary" dateTime={event.at}>{new Date(event.at).toLocaleTimeString("en-GB")}</time><span>{event.text}</span></li>)}</ol> : <p className="text-sm text-text-secondary">No activity yet.</p>}
      </div> : null}
    </footer>
    </div>
    </div>
    <StockWorkerPageLock active={pageLocked} footer={footer} />
    <StockWorkerCompletion jobs={jobs} canShow={canRefreshStockPage} blocked={pageLocked} />
    {lifecycle.dialog}
  </StockDealerSelectionProvider></StockWorkerControlProvider>;
}
