"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enqueueEnabledDealerStockScrapes } from "@/actions/admin/dealer-stock-sync";

export function SyncAllDealerStockButton({ disabledReason }: { disabledReason?: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1" title={disabledReason ?? undefined}>
      <button
        type="button"
        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-60"
        disabled={isPending || Boolean(disabledReason)}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await enqueueEnabledDealerStockScrapes();
            if ("error" in result && result.error) {
              setMessage(typeof result.error === "string" ? result.error : "Could not queue sync.");
              return;
            }
            setMessage(
              result.data?.queued
                ? `Queued ${result.data.queued} scrape${result.data.queued === 1 ? "" : "s"}. A background worker must be running.`
                : "No enabled dealers were queued.",
            );
            router.refresh();
          });
        }}
      >
        {isPending ? "Queueing…" : "Sync all enabled dealers"}
      </button>
      {message ? <p className="text-xs text-text-tertiary">{message}</p> : null}
    </div>
  );
}
