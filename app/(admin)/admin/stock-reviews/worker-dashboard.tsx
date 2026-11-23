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
import { OracleWorkerConnection, useOracleAvailability, type OracleConnectionState } from "./oracle-worker-connection";
import type { DesktopEnvironment } from "@/lib/dealer-stock-sync/desktop-config";

export interface LiveStockJob { id: string; dealerName: string; kind: string; status: string; startedAt: string | null; reportStatus?: string | null; reviewListingCount?: number | null }


function elapsed(start: string | null, now: number) {
  if (!start || !Number.isFinite(Date.parse(start))) return "";
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function fresh(device: WorkerDashboardDevice, now: number) {
  return device.online && device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) <= 35_000;
}

export function StockWorkerDashboard({ initial, jobs, readyCount, children, header, dealers = [], offlineContent, downloadFallback, initialNow = 0, managedSnapshot = false, connectionLost = false, oraclePilot = false, oracleEnvironment, pairingInProgress = false }: {
  managedSnapshot?: boolean; connectionLost?: boolean; oraclePilot?: boolean; oracleEnvironment?: DesktopEnvironment; pairingInProgress?: boolean;
  dealers?: StockDealer[]; offlineContent?: ReactNode; downloadFallback?: ReactNode; initialNow?: number; initial: WorkerDashboardResult; jobs: LiveStockJob[]; readyCount: number; children?: ReactNode; header?: ReactNode | ((badge: ReactNode) => ReactNode);
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
  const oracle = devices.find(row => row.scopedVm && fresh(row, now)) ?? devices.find(row => row.scopedVm);
  const oracleOnline = Boolean(oracle && fresh(oracle, now));
  const availability = useOracleAvailability(oraclePilot && !oracleOnline && !connectionLost && visibleSnapshot.ok);
  const oracleState: OracleConnectionState = connectionLost || !snapshot.ok ? "unknown" : oracleOnline ? "linked" :
    availability === "disabled" ? "offline" : availability === "available" ? (oracle ? "offline" : "unlinked") : availability;
  const windows = devices.filter(row => !row.scopedVm);
  const runningWindows = windows.find(row => stockWorkerIsRunning(fresh(row, now), row.state));
  const pilotDevice = runningWindows ?? (oracleState === "offline" ? windows.find(row => fresh(row, now)) : oracle);
  const device = oraclePilot ? pilotDevice : devices.find(row => row.deviceId === selected) ?? devices.find(row => fresh(row, now)) ?? devices[0];
  const online = visibleSnapshot.ok && Boolean(device && (connectionLost ? device.online : fresh(device, now)));
  const pilotReady = !oraclePilot || (!pairingInProgress && (oracleState === "linked" || oracleState === "offline"));
  const baseControls = useStockWorkerCommands(device, online && !connectionLost && (pilotReady || Boolean(runningWindows)), mergeSnapshot);
  const lifecycle = useStockAppLifecycle(baseControls, devices.filter(row => row.launchId).sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))[0]?.launchId, !oraclePilot || oracleState === "offline");
  const canRequest = !connectionLost && pilotReady && !(oraclePilot && oracleOnline && runningWindows);
  const controls = { ...baseControls, requestRun: canRequest ? lifecycle.requestRun : undefined, pending: baseControls.pending || lifecycle.pending };
  const { pending, running } = controls;
  const message = controls.message || lifecycle.message;
  const activeJobs = jobs.filter(job => job.status === "LEASED");
  const viewport = useWorkerViewport();
  const footer = useRef<HTMLElement>(null);
  const queued = jobs.filter(job => job.status === "QUEUED").length;
  const selection = useDealerSelection(dealers, controls, queued > 0, jobs.filter(job => job.status === "QUEUED").map(job => job.id));
  // A disconnected queue may require pairing or the Windows launch dialog before it can run.
  const queuedHere = queued > 0 && online && controls.online;
  const pageLocked = pending || activeJobs.length > 0 || stockWorkerIsRunning(online, device?.state)
    || Boolean(online && device?.pendingCommand) || queuedHere;
  const active = activeJobs.at(0);
  const latestFinished = jobs.filter(stockJobFinished).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))[0];
  const phase = device?.activity.at(-1)?.text ?? "Connected and ready";
  const busy = pageLocked;
  const offlineTitle = !oraclePilot ? "Start the Stock Update worker app" :
    pairingInProgress ? "Awaiting pairing" : oracleState === "unlinked" ? "Pairing required" :
    oracleState === "offline" ? "Oracle unavailable" : "Checking Oracle connection";
  const title = connectionLost ? "Updates paused — reconnecting" : !snapshot.ok ? "Connection status unavailable" : !online ? offlineTitle :
    device?.state === "error" ? "Worker needs attention" : device?.state === "stopping" ? "Stopping after the current job" :
    active ? `${active.kind === "APPLY" ? "Applying" : "Scanning"} · ${active.dealerName}` :
    pending || device?.pendingCommand ? "Request in progress" :
    running ? "Processing stock" : queued > 0 ? "Stock check queued" :
    message ? message : latestFinished ? stockJobOutcome(latestFinished) :
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

  const expandedStatus = busy;
  const badge = connectionLost ? "Reconnecting" : !snapshot.ok ? "Unavailable" : online ? (device?.scopedVm ? "Oracle Connected" : "Windows Connected") :
    pairingInProgress ? "Pairing" : oraclePilot && oracleState === "unlinked" ? "Unpaired" :
    oraclePilot && oracleState === "checking" ? "Checking" : "Offline";
  const detail = message || (pending || device?.pendingCommand ? "Waiting for acknowledgement" :
    active ? elapsed(active.startedAt, now) || "Processing stock" :
    queuedHere && !running ? `${queued} queued` : phase);
  const resumeQueue = queuedHere && !running && !active && !pending && !device?.pendingCommand && controls.canCommand && controls.requestRun;

  return <StockWorkerControlProvider value={controls}><StockDealerSelectionProvider value={selection}>
    {/* Keep document height stable as the navbar scrolls out and the inner viewport expands. */}
    <div className="min-h-dvh">
    <div ref={viewport.ref} style={{ height: viewport.height }} className="flex min-h-0 flex-col">
    <div data-stock-worker-content="" style={{ containerType: "size" }} className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-2 pb-6">
    {typeof header === "function" ? header(oraclePilot && oracleState === "linked" ? <span aria-label="Oracle VM connected" className="rounded-full border border-neon-blue-500/40 px-3 py-1 text-xs font-medium text-neon-blue-400">Oracle Connected</span> : null) : header}
    {!online ? offlineContent : null}
    {oraclePilot && oracleEnvironment ? (oracleState !== "linked" && !pairingInProgress && <OracleWorkerConnection state={oracleState} environment={oracleEnvironment} openWindows={lifecycle.open} pending={pending} windowsOnline={online && !device?.scopedVm} launchFeedback={<>
      {lifecycle.message && <p role="status" className="text-sm text-text-secondary">{lifecycle.message}</p>}
      {!pageLocked && lifecycle.launchFallback}
      {lifecycle.launchFailed && downloadFallback}
    </>} />) : <section aria-label="Worker connection" className="space-y-3 rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-text-primary">{title}</h2></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${online ? "border-neon-blue-500/40 text-neon-blue-400" : "border-border text-text-secondary"}`}>{connectionLost ? "Reconnecting" : online ? "Connected" : snapshot.ok ? "Not connected" : "Unavailable"}</span>
      </div>
      <p className="text-sm text-text-secondary">{!snapshot.ok ? "Retrying connection. Check the app before starting more work." :
        !online ? (device?.scopedVm ? "Reconnect the Oracle VM or choose another computer." : "Open Stock Update to connect to this site automatically.") :
        `${device?.deviceName} · ${device?.environment === "preview" ? "Preview — itrader.dev" : "Production — itrader.im"}`}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending || connectionLost} onClick={() => void lifecycle.open()} className="min-h-11 rounded-md border border-neon-blue-400 px-4 text-sm text-neon-blue-400 disabled:opacity-50">{device?.scopedVm ? "Open Windows Stock Update" : "Open Stock Update"}</button>
        {online && !device?.scopedVm ? <button type="button" disabled={!controls.canCommand || pending} onClick={() => controls.command("close")} className="min-h-11 rounded-md border border-border px-4 text-sm text-text-primary disabled:opacity-50">Close app safely</button> : null}
      </div>
      {lifecycle.message ? <p role="status" className="text-sm text-text-secondary">{lifecycle.message}</p> : null}
      {!pageLocked && lifecycle.launchFallback}
      {!online && lifecycle.launchFailed ? downloadFallback : null}
      {message && !online ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
      {devices.length > 1 ? <label className="block text-sm text-text-secondary">Computer <select disabled={pending} className="ml-2 rounded-md border border-border bg-surface p-2 text-text-primary" value={device?.deviceId ?? ""} onChange={event => setSelected(event.target.value)}>
        {devices.map(row => <option key={row.deviceId} value={row.deviceId}>{row.deviceName}{fresh(row, now) ? " — connected" : " — offline"}</option>)}
      </select></label> : null}
      {online ? <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary"><span>{queued} queued</span><span>{activeJobs.length} processing</span><a href="#stock-review-results" className="text-neon-blue-400 hover:underline">{readyCount} ready for review</a></div>
      {queued > 0 && !running ? <p className="text-sm text-text-secondary">Use Start queued work in the footer to process the saved queue.</p> : null}
      </> : null}
    </section>}
    {oraclePilot && oracleState === "linked" && lifecycle.message && <p role="status" className="text-sm text-text-secondary">{lifecycle.message}</p>}
    {children}
    </div>
    <footer ref={footer} aria-label="Stock Updater" data-stock-worker-dock="" data-compact={!expandedStatus && !expanded} className="shrink-0 border-t border-neon-blue-500/70 bg-canvas pb-[env(safe-area-inset-bottom)] text-text-secondary">
      {expanded ? <div id="stock-worker-activity" className="max-h-[35vh] overflow-y-auto border-t border-border px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">Recent worker activity</h3>
        {device?.activity.length ? <ol className="space-y-1 text-sm text-text-secondary">{[...device.activity].reverse().map(event => <li key={`${device.instanceId}:${event.sequence}`} className="flex gap-3"><time className="shrink-0 tabular-nums text-text-tertiary" dateTime={event.at}>{new Date(event.at).toLocaleTimeString("en-GB")}</time><span>{event.text}</span></li>)}</ol> : <p className="text-sm text-text-secondary">No activity yet.</p>}
      </div> : null}
      {busy && <div className={progressStyles.progressTrack} role="progressbar" aria-label="Stock update in progress">
        <div className={`h-full bg-neon-blue-500 ${progressStyles.moving}`} />
      </div>}
      <div className={progressStyles.footerRow} data-active={expandedStatus}>
        <div className="min-w-0">
          <div className={progressStyles.summary}><span className="shrink-0 text-xs font-normal text-text-primary">Stock Updater</span>
            <p role="status" title={title} className="truncate text-xs">{title}</p>
          </div>
          <div className={progressStyles.details} data-visible={expandedStatus} aria-hidden={!expandedStatus}>
            <div className="min-h-0 overflow-hidden"><p className="truncate text-xs" title={detail}>{detail}</p></div>
          </div>
        </div>
        <div className={progressStyles.footerControls}>
          <span className={`whitespace-nowrap rounded-full border px-2 text-xs ${online && !connectionLost ? "border-neon-blue-500/40 text-neon-blue-400" : "border-border"}`}>{badge}</span>
          <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="stock-worker-activity"
            className="whitespace-nowrap rounded-sm text-xs text-neon-blue-400 underline underline-offset-2">{expanded ? "Hide activity" : "Show activity"}</button>
          {running && <span data-stock-worker-commands=""><StockWorkerCommandButton running pending={pending} pendingCommand={Boolean(device?.pendingCommand)}
            stopping={device?.state === "stopping"} disabled={!controls.canCommand} onClick={() => controls.command("stop")} iconOnly /></span>}
          {lifecycle.pending && lifecycle.launchFallback}
          {resumeQueue && <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-neon-blue-400"
            onClick={() => void resumeQueue(async () => jobs.filter(job => job.status === "QUEUED").map(job => job.id))}>Start queued work</button>}
        </div>
      </div>
    </footer>
    </div>
    </div>
    <StockWorkerPageLock active={pageLocked} footer={footer} />
    <StockWorkerCompletion jobs={jobs} canShow={canRefreshStockPage} blocked={pageLocked} />
    {lifecycle.dialog}
  </StockDealerSelectionProvider></StockWorkerControlProvider>;
}
