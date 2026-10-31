"use client";
import type { EditableDraft } from "@/lib/listings/editable-draft";
import { stockSyncReason } from "@/lib/dealer-stock-sync/review";
import { Checkbox } from "@/components/ui/checkbox";
import { DiscardStockDraft } from "./discard-stock-draft";

function sourceLink(source: unknown) {
  if (!source || typeof source !== "object" || !("action" in source)) return null;
  const action = source.action as { sourceUrl?: unknown; review?: { sourceUrl?: unknown } } | null;
  const value = action?.sourceUrl ?? action?.review?.sourceUrl;
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function StockDraftReviewNotice({ review, confirmed, onConfirm, showConfirmation }: {
  review: NonNullable<EditableDraft["stockReview"]>;
  confirmed: boolean; onConfirm: (confirmed: boolean) => void; showConfirmation: boolean;
}) {
  const source = sourceLink(review.source);
  return <section aria-label="Received draft review" className="space-y-3 rounded-lg border border-neon-blue-500/40 bg-neon-blue-500/5 p-4">
    <h2 className="text-lg font-semibold text-text-primary">A draft has been prepared for you</h2>
    <p className="text-sm text-text-secondary">Review the details and upload or check the photos before submitting. These source warnings must be resolved. Any existing live listing stays unchanged until your draft changes are approved.</p>
    {review.blockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">{review.blockers.map((reason, index) => <li key={`${reason}-${index}`}>{stockSyncReason(reason)}</li>)}</ul>}
    {source && <a className="inline-block min-h-11 text-sm text-neon-blue-400 underline" href={source} target="_blank" rel="noreferrer">Check the original source listing</a>}
    {review.canDelete && review.lifecycleRevision != null && <DiscardStockDraft receiptId={review.receiptId} lifecycleRevision={review.lifecycleRevision} />}
    {showConfirmation ? <Checkbox className="h-9 w-9 rounded-md [&_svg]:h-6 [&_svg]:w-6" checked={confirmed} onCheckedChange={value => onConfirm(value === true)} label={<span className="flex min-h-11 items-center">I have reviewed the source warnings and corrected the details and photos for this draft.</span>} /> : <p className="text-sm text-text-secondary">You’ll confirm this review on the final step.</p>}
  </section>;
}
