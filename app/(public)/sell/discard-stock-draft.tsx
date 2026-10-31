"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discardReceivedStockDraft } from "@/actions/stock-drafts";
import { AccountConfirmDialog } from "@/components/account/account-confirm-dialog";
import { Alert } from "@/components/ui/alert";

export function DiscardStockDraft({ receiptId, lifecycleRevision }: { receiptId: string; lifecycleRevision: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function discard() {
    setError("");
    startTransition(async () => {
      try {
        const result = await discardReceivedStockDraft({ receiptId, expectedLifecycleRevision: lifecycleRevision });
        if (result.error) { setError(result.error); setOpen(false); return; }
        router.push("/dealer/listings?status=DRAFT");
        router.refresh();
      } catch { setError("Could not delete this draft. Refresh and try again."); setOpen(false); }
    });
  }
  return <div className="space-y-2">
    <button type="button" className="min-h-11 rounded-md border border-border px-3 text-sm text-text-error" onClick={() => setOpen(true)} disabled={pending}>Delete received draft</button>
    <AccountConfirmDialog open={open} onOpenChange={setOpen} title="Delete received draft?" description="This deletes the received draft and its unsent changes. Any existing live listing stays unchanged. This cannot be undone." confirmLabel="Delete draft" pendingLabel="Deleting draft…" destructive pending={pending} onConfirm={discard} />
    {error && <Alert status="error">{error}</Alert>}
  </div>;
}
