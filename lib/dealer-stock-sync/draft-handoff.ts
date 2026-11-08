import type { PlanAction } from "./types";
import { isSoldStockReviewAction } from "./review";

export const STOCK_REVIEW_HELD_ERROR = "This draft has been pulled back to admin stock review. Your saved changes and photos are preserved, but dealer editing and submission are no longer available.";

export interface StockDraftHandoff {
  receiptId: string;
  dealerId: string;
  reportId: string;
  listingId: string;
  sourceIdentityKey: string;
  revisionId: string | null;
  state: "dealer" | "moderation" | "admin";
  sentAt: string;
  recalledAt: string | null;
  blockers: string[];
  title: string;
  lifecycleRevision: number;
  photoRevision: number;
  updatedAt: string;
  revisionVersion: number | null;
}

interface ReceiptEvidence {
  id: string; reportId: string; dealerId: string; userId: string; listingId: string;
  sourceIdentityKey: string | null; revisionId: string | null; createdAt: Date;
  recalledAt: Date | null; blockers: string[];
  revision: { id: string; listingId: string; status: string; version: number } | null;
  listing: {
    id: string; dealerId: string | null; userId: string; status: string; stockReviewHeld: boolean;
    title: string; soldAt: Date | null; previewPackId: string | null; retentionPurgedAt: Date | null;
    lifecycleRevision: number; photoRevision: number; updatedAt: Date;
  };
}

export function classifyStockDraftHandoff(receipt: ReceiptEvidence, identity: {
  sourceIdentityKey: string; listingId: string | null;
} | null | undefined): StockDraftHandoff | null {
  const listing = receipt.listing;
  if (!receipt.sourceIdentityKey || identity?.sourceIdentityKey !== receipt.sourceIdentityKey ||
      identity.listingId !== listing.id || receipt.listingId !== listing.id ||
      receipt.dealerId !== listing.dealerId || receipt.userId !== listing.userId ||
      listing.soldAt || listing.previewPackId || listing.retentionPurgedAt) return null;
  const revision = receipt.revision;
  if (receipt.revisionId && (!revision || revision.id !== receipt.revisionId ||
      revision.listingId !== listing.id || listing.status !== "LIVE")) return null;
  const status = receipt.revisionId ? revision!.status : listing.status;
  const state = status === "PENDING" ? "moderation"
    : !receipt.revisionId && listing.stockReviewHeld && receipt.recalledAt && ["DRAFT", "REJECTED"].includes(status) ? "admin"
    : status === "DRAFT" && !receipt.recalledAt && !listing.stockReviewHeld ? "dealer" : null;
  if (!state) return null;
  return {
    receiptId: receipt.id, dealerId: receipt.dealerId, reportId: receipt.reportId, listingId: listing.id,
    sourceIdentityKey: receipt.sourceIdentityKey, revisionId: receipt.revisionId, state,
    sentAt: receipt.createdAt.toISOString(), recalledAt: receipt.recalledAt?.toISOString() ?? null,
    blockers: receipt.blockers, title: listing.title, lifecycleRevision: listing.lifecycleRevision,
    photoRevision: listing.photoRevision, updatedAt: listing.updatedAt.toISOString(),
    revisionVersion: revision?.version ?? null,
  };
}

const HANDOFF_REASONS = new Set([
  "status-preserved", "pending-revision", "awaiting-dealer-review", "submitted-dealer-review", "admin-stock-review",
]);

export function stockDraftReason(handoff: StockDraftHandoff) {
  return handoff.state === "dealer" ? "awaiting-dealer-review"
    : handoff.state === "moderation" ? "submitted-dealer-review" : "admin-stock-review";
}

/** Display enrichment only: never replace a saved report's fingerprint with these rows. */
export function decorateStockDraftActions(actions: PlanAction[], handoffs: StockDraftHandoff[], reportId: string): PlanAction[] {
  const decorated = actions.map(action => {
    if (isSoldStockReviewAction(action)) return action;
    const handoff = handoffs.find(item => item.listingId === action.listingId && item.sourceIdentityKey === action.sourceIdentityKey);
    if (action.stockDraft && !handoff && action.sourceIdentityKey &&
        action.kind === "blocked" && HANDOFF_REASONS.has(action.reason)) {
      return { kind: "unchanged" as const, sourceIdentityKey: action.sourceIdentityKey,
        listingId: action.listingId, displayTitle: `${action.stockDraft.title} (dealer handoff no longer pending)` };
    }
    return handoff && action.kind === "blocked" && HANDOFF_REASONS.has(action.reason)
      ? { ...action, displayTitle: handoff.title, stockDraft: handoff, reason: stockDraftReason(handoff) } : action;
  });
  const history = handoffs.filter(item => item.reportId === reportId &&
    !actions.some(action => action.sourceIdentityKey === item.sourceIdentityKey || action.listingId === item.listingId));
  return [...decorated, ...history.map((item): PlanAction => ({
    kind: "blocked", section: "change", reason: stockDraftReason(item),
    sourceIdentityKey: item.sourceIdentityKey, listingId: item.listingId, displayTitle: item.title, stockDraft: item,
  }))];
}

export function isStockDraftOwnedAction(action: PlanAction) {
  return Boolean(action.stockDraft) || (action.kind === "blocked" && [
    "awaiting-dealer-review", "submitted-dealer-review", "admin-stock-review",
  ].includes(action.reason));
}
