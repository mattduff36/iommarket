"use client";
import { useState, useTransition } from "react";
import { Check, X, Send, ListChecks, ListX } from "lucide-react";
import { useRouter } from "next/navigation";
import { reviewDealerStockSelection } from "@/actions/admin/dealer-stock-selection";
import { isApprovableStockAction, isRemovableStockAction, isDraftableStockAction, isSelectableStockAction } from "@/lib/dealer-stock-sync/selection";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";
import { useOptionalStockWorkerControl } from "../../../stock-reviews/worker-context";

export interface StockReviewSelection { indexes: number[]; setIndexes: (indexes: number[]) => void }
export function StockReviewSelectionControls({ reportId, fingerprint, actions, selection, onPendingChange }: {
  reportId: string; fingerprint: string; actions: PlanAction[]; selection: StockReviewSelection;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const reload = useStockSnapshotRefresh();
  const worker = useOptionalStockWorkerControl();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{error?: string; message?: string}>({});
  const chosen = selection.indexes.map(index => actions[index]).filter(Boolean);
  const eligible = actions.flatMap((action, index) => isApprovableStockAction(action) ? [index] : []);
  const blocked = actions.flatMap((action, index) => isSelectableStockAction(action) && (action.kind === "blocked" || action.kind === "conflict") ? [index] : []);
  const canApprove = chosen.length > 0 && chosen.every(isApprovableStockAction);
  const canRemove = chosen.length > 0 && chosen.every(isRemovableStockAction);
  const hasRemoval = chosen.some(isRemovableStockAction);
  const canDraft = chosen.length > 0 && chosen.every(isDraftableStockAction);
  function run(operation: "approve" | "remove" | "reject" | "draft", actionIndexes: number[]) {
    setFeedback({});
    startTransition(async () => {
      const perform = async (): Promise<string[]> => {
      onPendingChange?.(true);
      try {
        const result = await reviewDealerStockSelection({ reportId, fingerprint, operation, actionIndexes });
        if ("error" in result) { setFeedback({error: result.error ?? "Could not update this review."}); return []; }
        selection.setIndexes([]);
        setFeedback({message: "warning" in result && typeof result.warning === "string" ? result.warning : operation === "remove" ? "Selected removals queued. Listings will be taken down; other items remain for review." : operation === "approve" ? "Selected listings queued for approval. Other items remain for review." : operation === "draft" ? "Selected listings sent to the dealer's drafts." : "Selected items cleared. Listings have not been deleted."});
        if (reload) reload(); else router.refresh();
        return result.data.jobId ? [result.data.jobId] : [];
      } catch { setFeedback({error: "Could not update this review. Refresh the results and try again."}); return []; }
      finally { onPendingChange?.(false); }
      };
      if ((operation === "approve" || operation === "remove") && worker?.requestRun) await worker.requestRun(perform);
      else await perform();
    });
  }
  const actionClass = "min-h-11 shrink-0 gap-1.5 rounded-md px-2 text-xs font-medium normal-case not-italic tracking-normal";
  return <footer className="shrink-0 space-y-2 border-t border-border bg-surface p-2" aria-label="Review actions" aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
    <div className="flex shrink-0 items-center gap-1">
      <p className="whitespace-nowrap text-xs font-semibold tabular-nums text-text-primary" aria-live="polite">{chosen.length} selected</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => selection.setIndexes([])} disabled={pending || !chosen.length}
        title="Clear selection" className="min-h-11 min-w-9 px-2 text-text-secondary"><X size={14} aria-hidden="true" /><span className="sr-only">Clear selection</span></Button>
    </div>
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Selected listing actions">
      <Button type="button" variant="ghost" aria-label={hasRemoval ? "Approve selected removals" : "Approve selected"}
        title={hasRemoval ? "Select only removal suggestions to take those listings down. Listings are not deleted." : canApprove ? "Queue the selected eligible additions and updates." : "Select eligible additions or updates. Blocked items and removals cannot be approved here."}
        className={`${actionClass} bg-neon-blue-600 text-white hover:bg-neon-blue-500 hover:text-white`}
        disabled={pending || !(hasRemoval ? canRemove : canApprove)} onClick={() => run(hasRemoval ? "remove" : "approve", selection.indexes)}>
        <Check className="size-4 shrink-0" aria-hidden="true" /><span>{hasRemoval ? "Approve removal" : "Approve"}</span>
      </Button>
      <Button type="button" variant="ghost" aria-label="Send selected to dealer drafts"
        title={canDraft ? "Send selected items to dealer drafts. Live listings remain live." : "Select items with a safe source identity. Resolve protected or conflicting listings first."}
        className={`${actionClass} border border-border bg-surface-elevated text-text-primary`}
        disabled={pending || !canDraft} onClick={() => run("draft", selection.indexes)}>
        <Send className="size-4 shrink-0" aria-hidden="true" /><span>To drafts</span>
      </Button>
      <Button type="button" variant="ghost" aria-label="Reject and clear selected" title="Reject and clear selected suggestions. Existing listings are not deleted."
        className={`${actionClass} text-neon-red-400 hover:bg-neon-red-500/10 hover:text-neon-red-400`}
        disabled={pending || !chosen.length} onClick={() => run("reject", selection.indexes)}>
        <X className="size-4 shrink-0" aria-hidden="true" /><span>Reject</span>
      </Button>
    </div>
    <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Whole review actions">
      <Button type="button" variant="ghost" aria-label={`Approve all eligible (${eligible.length})`}
        title="Approve all eligible additions and updates. Blocked items and removals are excluded."
        className="min-h-11 gap-1.5 px-2 text-xs font-medium normal-case not-italic text-neon-blue-400 hover:text-neon-blue-400"
        disabled={pending || !eligible.length} onClick={() => run("approve", eligible)}>
        <ListChecks className="size-4 shrink-0" aria-hidden="true" />Approve eligible <span className="tabular-nums">({eligible.length})</span>
      </Button>
      <Button type="button" variant="ghost" aria-label={`Reject and clear all blocked (${blocked.length})`}
        title="Reject and clear all blocked and conflicting suggestions. Existing listings are unaffected."
        className="min-h-11 gap-1.5 px-2 text-xs font-medium normal-case not-italic text-neon-red-400 hover:bg-neon-red-500/10 hover:text-neon-red-400"
        disabled={pending || !blocked.length} onClick={() => run("reject", blocked)}>
        <ListX className="size-4 shrink-0" aria-hidden="true" />Clear blocked <span className="tabular-nums">({blocked.length})</span>
      </Button>
    </div>
    </div>
    {feedback.error && <Alert status="error">{feedback.error}</Alert>}
    {feedback.message && <Alert status="success">{feedback.message}</Alert>}
  </footer>;
}
