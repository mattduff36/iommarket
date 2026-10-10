"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDealerStockReport, rejectDealerStockReport } from "@/actions/admin/dealer-stock-sync";

export function ApproveStockReportButton({
  reportId,
  fingerprint,
}: {
  reportId: string;
  fingerprint: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error?: unknown }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Could not update this review.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
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
        Reject
      </button>
      {error ? (
        <p className="w-full text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
