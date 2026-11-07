"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/navigation/link";
import { reviewDealerStockDraftOwnership } from "@/actions/admin/dealer-stock-draft-ownership";
import { AdminListingEditButton } from "@/components/admin/listing-edit-button";
import { StockDraftPhotosButton } from "@/components/admin/stock-draft-photos-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportableError } from "@/components/monitoring/reportable-error";
import type { StockDraftHandoff } from "@/lib/dealer-stock-sync/draft-handoff";
import { stockSyncReason } from "@/lib/dealer-stock-sync/review";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";

export function StockDraftOwnership({ draft, reportId, fingerprint, status }: {
  draft: StockDraftHandoff; reportId: string; fingerprint: string; status: string;
}) {
  const router = useRouter();
  const reload = useStockSnapshotRefresh();
  const refresh = () => { if (reload) reload(); else router.refresh(); };
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = draft.state === "admin";
  const enabled = ["PENDING_REVIEW", "REJECTED", "APPLIED"].includes(status);
  const title = admin ? "Send to listing moderation" : "Pull back to review";
  const description = admin
    ? "Confirm you have reviewed availability, listing details and photos. The same saved listing will be sent to listing moderation, not published. Dealer editing remains disabled. Admin review is recorded separately from any dealer declaration. Validation errors must be corrected first."
    : "Return this draft to admin stock review for correction and approval, not directly to listing moderation. All saved dealer edits, photos and the original listing identity will be preserved. The dealer will no longer be able to edit, delete or submit it, including from an already-open tab. Nothing will be published.";
  async function submit() {
    setBusy(true); setError(null);
    try {
      const result = await reviewDealerStockDraftOwnership({
        reportId, fingerprint, dealerId: draft.dealerId, receiptId: draft.receiptId,
        listingId: draft.listingId, sourceIdentityKey: draft.sourceIdentityKey,
        expectedLifecycleRevision: draft.lifecycleRevision, expectedPhotoRevision: draft.photoRevision,
        expectedUpdatedAt: draft.updatedAt, operation: admin ? "moderation" : "recall", confirmed: true,
      });
      if (result.error) { setError(result.error); return; }
      setConfirm(false); refresh();
    } catch { setError("The ownership change could not be confirmed. Refresh this review before retrying."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-2 rounded-md border border-border bg-canvas/40 p-3 text-text-secondary" data-stock-review-editing={confirm ? "true" : undefined}>
    <p>{admin ? "Returned to admin stock review. Dealer editing and submission are disabled. Correct the saved listing, then explicitly send it to listing moderation."
      : draft.state === "moderation" ? "The draft has been submitted and is awaiting listing moderation. It is not an editable dealer draft and cannot be handed off or approved again from this stock report."
        : "Already sent to dealer drafts. The dealer must review the imported issues, finish the saved details and photos, and submit for moderation. A repeat scrape will not create another draft."}</p>
    <p className="text-xs">Sent {new Date(draft.sentAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}{draft.recalledAt ? ` · Pulled back ${new Date(draft.recalledAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}. Receipt: {draft.receiptId}.</p>
    {draft.blockers.length > 0 && <p className="text-xs">Issues recorded at handoff (not a current validation): {draft.blockers.map(stockSyncReason).join("; ")}.</p>}
    {draft.revisionId ? <p>This handoff contains changes to a live listing. Pull back currently supports new dealer drafts only; resolve this revision through listing moderation. The live listing is untouched.</p>
      : draft.state === "moderation" ? <Link href="/admin/listings?status=PENDING" className="inline-block py-2 text-neon-blue-400 hover:underline">Open listing moderation</Link>
        : <>
          {admin && <div className="flex flex-wrap gap-2">
            <AdminListingEditButton listingId={draft.listingId} label="Correct saved listing" onSaved={refresh} />
            <StockDraftPhotosButton listingId={draft.listingId} onSaved={refresh} />
          </div>}
          <Button type="button" size="sm" variant="ghost" className="border border-border" disabled={!enabled || busy} onClick={() => { setError(null); setConfirm(true); }}>{title}</Button>
          {!enabled && <p className="text-xs">Open the latest completed stock review to change ownership.</p>}
        </>}
    <Dialog open={confirm} onOpenChange={value => { if (!busy) setConfirm(value); }}>
      <DialogContent><DialogHeader><DialogTitle>{title}?</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {error && <ReportableError role="alert">{error}</ReportableError>}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button type="button" disabled={busy} onClick={submit}>{busy ? "Saving..." : title}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
