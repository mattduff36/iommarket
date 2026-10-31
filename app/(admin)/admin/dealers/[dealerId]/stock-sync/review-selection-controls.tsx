"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewDealerStockSelection } from "@/actions/admin/dealer-stock-selection";
import { isApprovableStockAction, isDraftableStockAction, isSelectableStockAction } from "@/lib/dealer-stock-sync/selection";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";

export interface StockReviewSelection { indexes: number[]; setIndexes: (indexes: number[]) => void }
export function StockReviewSelectionControls({ reportId, fingerprint, actions, selection, onPendingChange }: {
  reportId: string; fingerprint: string; actions: PlanAction[]; selection: StockReviewSelection;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const reload = useStockSnapshotRefresh();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{error?: string; message?: string}>({});
  const chosen = selection.indexes.map(index => actions[index]).filter(Boolean);
  const eligible = actions.flatMap((action, index) => isApprovableStockAction(action) ? [index] : []);
  const blocked = actions.flatMap((action, index) => isSelectableStockAction(action) && (action.kind === "blocked" || action.kind === "conflict") ? [index] : []);
  const canApprove = chosen.length > 0 && chosen.every(isApprovableStockAction);
  const canDraft = chosen.length > 0 && chosen.every(isDraftableStockAction);
  function run(operation: "approve" | "reject" | "draft", actionIndexes: number[]) {
    setFeedback({});
    onPendingChange?.(true);
    startTransition(async () => {
      try {
        const result = await reviewDealerStockSelection({ reportId, fingerprint, operation, actionIndexes });
        if ("error" in result) { setFeedback({error: result.error ?? "Could not update this review."}); return; }
        selection.setIndexes([]);
        setFeedback({message: "warning" in result && typeof result.warning === "string" ? result.warning : operation === "approve" ? "Selected listings queued for approval. Other items remain for review." : operation === "draft" ? "Selected listings sent to the dealer's drafts." : "Selected items cleared. Listings have not been deleted."});
        if (reload) reload(); else router.refresh();
      } catch { setFeedback({error: "Could not update this review. Refresh the results and try again."}); }
      finally { onPendingChange?.(false); }
    });
  }
  return <div className="sticky top-0 z-10 space-y-3 rounded-lg border border-neon-blue-500/30 bg-surface p-4 shadow-sm" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold text-text-primary" aria-live="polite">{chosen.length} selected</p>
      <button type="button" onClick={() => selection.setIndexes([])} disabled={pending || !chosen.length} className="min-h-10 px-2 text-sm text-text-secondary underline disabled:opacity-40">Clear selection</button>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Selected listing actions">
      <span title={canApprove ? "Queue only the selected eligible additions and updates. Other items stay in this review." : "Select eligible additions or updates only. Blocked items and removal suggestions cannot be approved here."}>
        <Button type="button" variant="trust" className="min-h-11" disabled={pending || !canApprove} onClick={() => run("approve", selection.indexes)}>Approve selected</Button>
      </span>
      <span title="Clear the selected review suggestions. This does not delete the dealer's listings."><Button type="button" variant="ghost" className="min-h-11 border border-border" disabled={pending || !chosen.length} onClick={() => run("reject", selection.indexes)}>Reject and clear selected</Button></span>
      <span title={canDraft ? "Send these items to the dealer to edit, submit or delete. Live listings remain live while draft changes are reviewed." : "Select items with a safe source identity. Protected or conflicting listings must be resolved first."}><Button type="button" variant="ghost" className="min-h-11 border border-border" disabled={pending || !canDraft} onClick={() => run("draft", selection.indexes)}>Send selected to dealer drafts</Button></span>
    </div>
    <div className="flex flex-wrap gap-2 border-t border-border pt-3" role="group" aria-label="Whole review actions">
      <span title="Approve every eligible addition and update in this review. Blocked items and removal suggestions are excluded."><Button type="button" variant="ghost" disabled={pending || !eligible.length} onClick={() => run("approve", eligible)}>Approve all eligible ({eligible.length})</Button></span>
      <span title="Clear all blocked and conflicting suggestions from this review. Existing listings are unaffected."><Button type="button" variant="ghost" disabled={pending || !blocked.length} onClick={() => run("reject", blocked)}>Reject and clear all blocked ({blocked.length})</Button></span>
    </div>
    {feedback.error && <Alert status="error">{feedback.error}</Alert>}
    {feedback.message && <Alert status="success">{feedback.message}</Alert>}
  </div>;
}
