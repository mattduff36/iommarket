"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";
import { approveDealerStockReport, rejectDealerStockReport } from "@/actions/admin/dealer-stock-sync";

export function ApproveStockReportButton({
  reportId,
  fingerprint,
}: {
  reportId: string;
  fingerprint: string;
}) {
  const router = useRouter();
  const reloadSnapshot = useStockSnapshotRefresh();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error?: unknown }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(typeof result.error === "string" ? result.error : "Could not update this review.");
          return;
        }
        if (reloadSnapshot) reloadSnapshot(); else router.refresh();
      } catch {
        setError("The update outcome is uncertain. Check the saved result before trying again.");
      }
    });
  }

  return (
    <div data-stock-review-editing={isPending ? "true" : undefined} className="flex flex-wrap gap-2">
      <button
        type="button"
        className="rounded-md bg-neon-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={isPending}
        onClick={() => run(() => approveDealerStockReport({ reportId, fingerprint }))}
      >
        Approve exact plan
      </button>
      <button
        type="button"
        className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
        disabled={isPending}
        onClick={() => run(() => rejectDealerStockReport({ reportId }))}
      >
        Reject and clear
      </button>
      {isPending ? <p role="status" className="w-full text-sm text-text-secondary">Updating review…</p> : null}
      {error ? (
        <ReportableError as="p" className="w-full text-sm text-text-error" role="alert">
          {error}
        </ReportableError>
      ) : null}
    </div>
  );
}
