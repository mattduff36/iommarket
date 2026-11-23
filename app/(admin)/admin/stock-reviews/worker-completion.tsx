"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

export function StockWorkerCompletion({ jobs, canShow, blocked = false, liveQueue }: {
  jobs: LiveStockJob[]; canShow: () => boolean; blocked?: boolean; liveQueue: (current: LiveStockJob[], dismiss?: () => void) => ReactNode;
}) {
  // Existing history is a baseline, not a new completion notification.
  const seen = useRef(new Set(jobs.map(job => job.id)));
  const run = useRef(new Map(jobs.filter(job => !stockJobFinished(job)).map(job => [job.id, job])));
  const [visibleRun, setVisibleRun] = useState(() => [...run.current.values()]);
  const waiting = useRef<LiveStockJob[][]>([]);
  const [notice, setNotice] = useState<LiveStockJob[] | null>(null);

  useLayoutEffect(() => {
    for (const job of jobs) {
      if (!seen.current.has(job.id) || run.current.has(job.id) || !stockJobFinished(job)) run.current.set(job.id, job);
      seen.current.add(job.id);
    }
    // Retain observed jobs beyond the recent-history limit. An active job that
    // disappears is not evidence of completion.
    if (run.current.size) setVisibleRun([...run.current.values()]);
    if (run.current.size && [...run.current.values()].every(stockJobFinished)) {
      waiting.current.push([...run.current.values()]);
      run.current.clear();
    }
  }, [jobs]);
  useLayoutEffect(() => {
    if (!blocked && !run.current.size) setVisibleRun(previous => previous.length ? [] : previous);
  }, [blocked, jobs]);

  useLayoutEffect(() => {
    function showNext() {
      if (!blocked && !notice && waiting.current.length && canShow()) setNotice(waiting.current.shift()!);
    }
    showNext();
    // A completion that arrives during editing waits until the editor closes.
    const timer = window.setInterval(showNext, 1_000);
    return () => window.clearInterval(timer);
  }, [notice, canShow, blocked, jobs]);

  if (blocked) return liveQueue(visibleRun);
  if (notice) return liveQueue(notice, () => setNotice(null));
  // Keep the same surface mounted while the final snapshot is reconciled.
  if (visibleRun.length && canShow() && jobs.some(job => stockJobFinished(job) && visibleRun.some(row => row.id === job.id))) return liveQueue(visibleRun);
  return null;
}
