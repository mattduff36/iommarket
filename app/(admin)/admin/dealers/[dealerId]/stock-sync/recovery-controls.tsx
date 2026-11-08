"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { recoverDealerStockReport } from "@/actions/admin/dealer-stock-recovery";
import { stockApplyOutcome, type StockApplyRecovery } from "@/lib/dealer-stock-sync/apply-recovery";
import { useOptionalStockWorkerControl } from "../../../stock-reviews/worker-context";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";

export function StockApplyRecoveryControls({ reportId, fingerprint, recovery }: {
  reportId: string; fingerprint: string; recovery?: StockApplyRecovery | null;
}) {
  const router = useRouter();
  const reload = useStockSnapshotRefresh();
  const worker = useOptionalStockWorkerControl();
  const requestRun = worker?.requestRun;
  const [pending, startTransition] = useTransition();
  const lock = useRef(false);
  const [queued, setQueued] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const refresh = () => { if (reload) reload(); else router.refresh(); };
  function run(operation: "retry" | "fresh") {
    if (!requestRun || lock.current || queued || recovery?.activeJob) return;
    lock.current = true;
    setFeedback({});
    startTransition(async () => {
      const perform = async (): Promise<string[]> => {
        try {
          const result = await recoverDealerStockReport(operation === "retry" ? {
            reportId, fingerprint, operation, expectedJobId: recovery?.attempt?.id,
          } : { reportId, fingerprint, operation });
          if (!("data" in result) || !result.data) { setFeedback({ error: result.error }); refresh(); return []; }
          setQueued(true);
          setFeedback({ message: operation === "retry" ? "Approved changes queued for retry. The saved approval is unchanged." : "Fresh check queued. Review and approve its new results before listings change." });
          refresh();
          return [result.data.jobId];
        } catch {
          setFeedback({ error: "The request outcome is uncertain. Refresh the results and check the current task before trying again." });
          refresh();
          return [];
        }
      };
      try { await requestRun(perform); }
      catch { setFeedback({ error: "The worker request outcome is uncertain. Refresh and check the current task." }); refresh(); }
      finally { lock.current = false; }
    });
  }
  const blocked = pending || queued || Boolean(recovery?.activeJob) || Boolean(worker?.pending || worker?.stopping);
  if (!requestRun) return <footer aria-label="Approved review recovery" className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
    <p className="text-sm font-semibold text-text-primary" role="status">{stockApplyOutcome(recovery) ?? "Approved changes need a current processing attempt"}</p>
    <p className="text-sm text-text-secondary">Open Stock Reviews to retry the approved changes or run a fresh check with the Stock Update app.</p>
    <a href={"/admin/stock-reviews?report=" + encodeURIComponent(reportId)} className="inline-flex min-h-11 items-center rounded-md border border-neon-blue-400 px-3 text-sm text-neon-blue-400 hover:underline">Open stock recovery</a>
  </footer>;
  return <footer aria-label="Approved review recovery" aria-busy={pending} className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
    <p className="text-sm font-semibold text-text-primary" role="status">{stockApplyOutcome(recovery) ?? "Approved changes need a current processing attempt"}</p>
    <p className="text-sm text-text-secondary">{recovery?.activeJob ? recovery.reason : recovery?.retryable ? "Retry the changes you already approved, or run a fresh check to review current stock." : recovery?.reason ?? "Run a fresh check to obtain an up-to-date review. A missing task is not evidence that retrying is safe."}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={blocked || !recovery?.retryable} onClick={() => run("retry")} className="min-h-11">Retry approved changes</Button>
      <Button type="button" size="sm" variant="ghost" disabled={blocked} onClick={() => run("fresh")} className="min-h-11 border border-border">Run a fresh check</Button>
    </div>
    {feedback.error && <Alert status="error">{feedback.error}</Alert>}
    {feedback.message && <Alert status="success">{feedback.message}</Alert>}
  </footer>;
}
