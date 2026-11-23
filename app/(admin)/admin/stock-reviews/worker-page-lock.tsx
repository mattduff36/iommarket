"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import { lockStockWorkerPage } from "./worker-page-lock-dom";
import { stockJobFinished, stockJobOutcome } from "./worker-completion";
import type { LiveStockJob } from "./worker-dashboard";
import { StockUpdaterLogo } from "./stock-updater-logo";

function jobView(job: LiveStockJob) {
  if (!stockJobFinished(job)) {
    if (job.status === "LEASED") return { label: job.kind === "APPLY" ? "Applying" : "Scanning", description: job.kind === "APPLY" ? "Applying approved changes" : "Checking dealer stock", icon: LoaderCircle, tone: "text-neon-blue-400" };
    return { label: "Queued", description: "Waiting for worker", icon: Circle, tone: "text-text-tertiary" };
  }
  const failed = job.status === "FAILED" || job.reportStatus === "FAILED";
  const cancelled = job.status === "CANCELLED";
  return {label: failed ? "Failed" : cancelled ? "Cancelled" : "Complete", description: stockJobOutcome(job).slice(job.dealerName.length + 2),
    icon: failed || cancelled ? X : Check, tone: failed ? "text-text-error" : cancelled ? "text-text-tertiary" : "text-emerald-400"};
}

export function StockWorkerPageLock({ footer, jobs, badge, status, dismiss }: {
  footer: RefObject<HTMLElement | null>; jobs: LiveStockJob[]; badge: string; status: string; dismiss?: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(document.body); }, []);
  useLayoutEffect(() => {
    if (host && footer.current && surface.current) return lockStockWorkerPage(footer.current, surface.current);
  }, [footer, host]);
  const done = useRef<HTMLButtonElement>(null);
  const completed = Boolean(dismiss);
  useEffect(() => {
    if (completed && host) done.current?.focus({ preventScroll: true });
  }, [completed, host]);
  if (!host) return null;
  const finished = jobs.filter(stockJobFinished).length;
  const working = jobs.find(job => job.status === "LEASED");
  return createPortal(<div ref={surface} className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] grid h-dvh grid-rows-[minmax(0,1fr)] place-items-center p-3 sm:p-5">
    <section role={completed ? "dialog" : undefined} aria-label={completed ? "Stock Updater run finished" : "Live dealer queue"}
      onKeyDown={event => { if (event.key === "Escape" && dismiss) { event.preventDefault(); dismiss(); } }} className="pointer-events-auto flex max-h-full min-h-0 w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-2xl">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-text-secondary"><span aria-hidden="true" className="size-1.5 rounded-full bg-neon-blue-400" />Stock Updater</h2>
        <span className={`rounded-full border px-2 text-xs ${badge.endsWith(" Connected") ? "border-neon-blue-400/40 text-neon-blue-400" : "border-border text-text-secondary"}`}>{badge}</span>
      </header>
      {badge === "Reconnecting" && <p role="status" className="px-4 pt-2 text-xs text-text-secondary">Showing the last received queue while we reconnect.</p>}
      <div className="grid h-[clamp(4rem,16dvh,9rem)] w-full shrink-0 place-items-center"><StockUpdaterLogo animated={!completed} /></div>
      <div className="flex shrink-0 items-baseline justify-between gap-2 px-4">
        <h3 className="text-sm font-semibold text-text-primary">{completed ? "Run complete" : "Dealer queue"}</h3>
        {jobs.length > 0 && <span role="status" aria-atomic="true" className="text-xs tabular-nums text-text-secondary">{finished} of {jobs.length} complete<span className="sr-only">{working ? `. ${jobView(working).label} ${working.dealerName}` : ""}</span></span>}
      </div>
      {jobs.length > 0 ? <>
        <div aria-hidden="true" className="mx-4 my-2 flex shrink-0 gap-1">{jobs.map(job => <span key={job.id} className={`h-0.5 flex-1 ${job.status === "FAILED" || job.reportStatus === "FAILED" ? "bg-red-400" : job.status === "SUCCEEDED" ? "bg-emerald-400" : job.status === "LEASED" ? "bg-neon-blue-400" : "bg-border"}`} />)}</div>
        <ol aria-label="Jobs in this run" tabIndex={0} className="mx-4 mb-3 min-h-[2.5rem] divide-y divide-border overflow-y-auto overscroll-contain focus-visible:outline-neon-blue-400">
          {jobs.map(job => {const {label,description,icon: Icon,tone} = jobView(job);return <li key={job.id} className="flex items-center gap-3 py-2">
            <Icon aria-hidden="true" size={14} className={`shrink-0 ${tone} ${job.status === "LEASED" ? "motion-safe:animate-spin" : ""}`} />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text-primary">{job.dealerName}</p><p className="text-xs text-text-secondary">{description}</p></div>
            {completed && job.resultHref ? <a href={job.resultHref} aria-label={`Open ${job.dealerName} result`} className="shrink-0 rounded-sm text-xs text-neon-blue-400 underline underline-offset-2">{job.status === "FAILED" || job.reportStatus === "FAILED" ? "View failure" : job.resultHref.includes("history=archived") ? "View archived" : "View result"}</a> : <span className={`text-xs ${tone}`}>{label}</span>}
          </li>})}
        </ol>
      </> : <p role="status" className="px-4 pb-4 pt-2 text-xs text-text-secondary">{status}</p>}
      {completed && <div className="flex justify-end border-t border-border px-4 py-3"><button ref={done} type="button" onClick={dismiss} className="rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-medium text-white">Done</button></div>}
    </section>
  </div>, host);
}
