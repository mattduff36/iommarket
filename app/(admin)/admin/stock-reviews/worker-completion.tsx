"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { LiveStockJob } from "./worker-dashboard";

export function stockJobFinished(job: LiveStockJob) {
  return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status);
}

function scanReviewSuffix(job: LiveStockJob): string | null {
  const count = job.reviewListingCount;
  if (job.status !== "SUCCEEDED" || job.kind !== "SCRAPE" || job.reportStatus !== "PENDING_REVIEW" ||
      count == null || !Number.isSafeInteger(count) || count < 0) return null;
  return count === 0 ? "- no new changes" : `- ${count} ${count === 1 ? "listing" : "listings"} for review`;
}

export function stockJobOutcome(job: LiveStockJob) {
  if (job.status === "FAILED" || job.reportStatus === "FAILED") return `${job.dealerName}: task failed — check the saved result`;
  if (job.status === "CANCELLED") return `${job.dealerName}: task cancelled`;
  if (job.reportStatus === "APPLIED") return `${job.dealerName}: finished — stock update applied`;
  if (job.reportStatus === "APPROVED") return `${job.dealerName}: finished — report approved, awaiting application`;
  const suffix = scanReviewSuffix(job);
  if (suffix !== null) return `${job.dealerName}: Success ${suffix}`;
  if (job.status === "SUCCEEDED" && job.reportStatus === "PENDING_REVIEW") return `${job.dealerName}: Success - check the saved result`;
  return `${job.dealerName}: finished — check the saved result`;
}

export function StockWorkerCompletion({ jobs, canShow, blocked = false }: { jobs: LiveStockJob[]; canShow: () => boolean; blocked?: boolean }) {
  // Existing history is a baseline, not a new completion notification.
  const seen = useRef(new Set(jobs.map(job => job.id)));
  const run = useRef(new Map(jobs.filter(job => !stockJobFinished(job)).map(job => [job.id, job])));
  const waiting = useRef<LiveStockJob[][]>([]);
  const [notice, setNotice] = useState<LiveStockJob[] | null>(null);

  useEffect(() => {
    for (const job of jobs) {
      if (!seen.current.has(job.id) || run.current.has(job.id) || !stockJobFinished(job)) run.current.set(job.id, job);
      seen.current.add(job.id);
    }
    // Retain observed jobs beyond the recent-history limit. An active job that
    // disappears is not evidence of completion.
    if (run.current.size && [...run.current.values()].every(stockJobFinished)) {
      waiting.current.push([...run.current.values()]);
      run.current.clear();
    }
  }, [jobs]);

  useEffect(() => {
    function showNext() {
      if (!blocked && !notice && waiting.current.length && canShow()) setNotice(waiting.current.shift()!);
    }
    showNext();
    // A completion that arrives during editing waits until the editor closes.
    const timer = window.setInterval(showNext, 1_000);
    return () => window.clearInterval(timer);
  }, [notice, canShow, blocked]);

  return <Dialog open={!blocked && notice !== null} onOpenChange={open => { if (!open && !blocked) setNotice(null); }}>
    <DialogContent onPointerDownOutside={event => event.preventDefault()}>
      <DialogTitle>Stock Update run finished</DialogTitle>
      <DialogDescription className="mt-3">
        All {notice?.length ?? 0} tasks in this run have ended. Review the results below. Failed tasks need attention; any proposed listing changes require your approval.
      </DialogDescription>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
        {notice?.map(job => {
          const outcome = stockJobOutcome(job).slice(job.dealerName.length + 2);
          const failed = job.status === "FAILED" || job.reportStatus === "FAILED";
          const suffix = scanReviewSuffix(job);
          return <li key={job.id} className="text-text-primary">
            {job.dealerName}: {failed
              ? <><span className="text-red-400">task failed</span> — check the saved result</>
              : suffix !== null
                ? <><span className="text-emerald-400">Success</span>{" "}<span className={job.reviewListingCount === 0 ? "text-text-primary" : "text-emerald-400"}>{suffix}</span></>
                : <span className={job.status === "SUCCEEDED" ? "text-emerald-400" : undefined}>{outcome}</span>}
          </li>;
        })}
      </ul>
      <button type="button" className="mt-4 rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-semibold text-white" onClick={() => setNotice(null)}>Got it</button>
    </DialogContent>
  </Dialog>;
}
