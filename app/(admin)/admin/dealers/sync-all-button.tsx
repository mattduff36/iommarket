"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enqueueEnabledDealerStockScrapes } from "@/actions/admin/dealer-stock-sync";
import { StockAppTaskBoundary } from "../stock-reviews/app-task-boundary";
import { useStockWorkerControl } from "../stock-reviews/worker-context";

export function SyncAllDealerStockButton(props: { disabledReason?: string | null }) {
  return <StockAppTaskBoundary><SyncAllButton {...props} /></StockAppTaskBoundary>;
}
function SyncAllButton({ disabledReason }: { disabledReason?: string | null }) {
  const router = useRouter();
  const worker = useStockWorkerControl();
  const [isPending, setPending] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    if (!worker.requestRun || lock.current) return;
    lock.current = true;
    setPending(true);
    setMessage(null);
    try {
      await worker.requestRun(async () => {
        const result = await enqueueEnabledDealerStockScrapes();
        if (result.error) { setMessage(result.error); return []; }
        const ids = result.data?.jobIds ?? [];
        setMessage(ids.length ? `${ids.length} dealer scrape${ids.length === 1 ? "" : "s"} ready for Stock Update.` : "No enabled dealers were queued.");
        router.refresh();
        return ids;
      });
    } catch { setMessage("The sync request outcome is uncertain. Check task results before trying again."); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="flex flex-col items-start gap-1" title={disabledReason ?? undefined}>
    <button type="button" className="rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-60"
      disabled={isPending || Boolean(disabledReason) || !worker.requestRun || worker.pending || worker.stopping} onClick={() => void run()}>
      {isPending ? "Queueing…" : "Sync all enabled dealers"}
    </button>
    {message ? <p className="text-xs text-text-tertiary">{message}</p> : null}
  </div>;
}
