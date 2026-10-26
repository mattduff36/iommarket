"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { LiveStockJob } from "./worker-dashboard";

export function stockJobFinished(job: LiveStockJob) {
  return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status);
}

export function stockJobOutcome(job: LiveStockJob) {
  if (job.status === "FAILED" || job.reportStatus === "FAILED") return `${job.dealerName}: task failed — check the saved result`;
  if (job.status === "CANCELLED") return `${job.dealerName}: task cancelled`;
  if (job.reportStatus === "APPLIED") return `${job.dealerName}: finished — stock update applied`;
  if (job.reportStatus === "PENDING_REVIEW") return `${job.dealerName}: finished — ready for review`;
  if (job.reportStatus === "APPROVED") return `${job.dealerName}: finished — report approved, awaiting application`;
  return `${job.dealerName}: finished — check the saved result`;
}

export function StockWorkerCompletion({ jobs, canShow }: { jobs: LiveStockJob[]; canShow: () => boolean }) {
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
      if (!notice && waiting.current.length && canShow()) setNotice(waiting.current.shift()!);
    }
    showNext();
    // A completion that arrives during editing waits until the editor closes.
    const timer = window.setInterval(showNext, 1_000);
    return () => window.clearInterval(timer);
  }, [notice, canShow]);

  return <Dialog open={notice !== null} onOpenChange={open => { if (!open) setNotice(null); }}>
    <DialogContent onPointerDownOutside={event => event.preventDefault()}>
      <DialogTitle>Stock Update run finished</DialogTitle>
      <DialogDescription className="mt-3">
        All {notice?.length ?? 0} tasks in this run have ended. Review the results below. Failed tasks need attention; successful scans still require your approval before listings change.
      </DialogDescription>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
        {notice?.map(job => <li key={job.id}>{stockJobOutcome(job)}</li>)}
      </ul>
      <button type="button" className="mt-4 rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-semibold text-white" onClick={() => setNotice(null)}>Got it</button>
    </DialogContent>
  </Dialog>;
}
