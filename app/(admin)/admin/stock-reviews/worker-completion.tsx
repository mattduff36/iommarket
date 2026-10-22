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
  const seen = useRef(new Map(jobs.map(job => [job.id, job.status])));
  const waiting = useRef<LiveStockJob[]>([]);
  const [notice, setNotice] = useState<LiveStockJob | null>(null);

  useEffect(() => {
    for (const job of jobs) {
      const previous = seen.current.get(job.id);
      if (stockJobFinished(job) && previous !== job.status) waiting.current.push(job);
      seen.current.set(job.id, job.status);
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
      <DialogTitle>{notice ? stockJobOutcome(notice) : "Stock Update result"}</DialogTitle>
      <DialogDescription className="mt-3">
        This task has ended. Check its saved result below before taking further action.
        The worker can remain connected for more queued work; this does not mean this task is still running.
      </DialogDescription>
      <button type="button" className="mt-4 rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-semibold text-white" onClick={() => setNotice(null)}>Got it</button>
    </DialogContent>
  </Dialog>;
}
