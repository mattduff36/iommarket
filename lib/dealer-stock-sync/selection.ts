import { isSoldStockReviewAction } from "./review";
import type { PlanAction } from "./types";

// Desktop inventory and apply execution both cap a review at 2,000 actions.
export const MAX_STOCK_REVIEW_SELECTION = 2000;
export const MAX_STOCK_DRAFT_SELECTION = 100;

const PROTECTED_DRAFT_REASONS = new Set([
  "duplicate-managed-listing", "duplicate-source", "unstable-identity", "unmapped-existing-stock",
  "pending-revision", "preview-listing", "manual-taken-down", "sold-preserved", "source-sold",
  "status-preserved", "source-conflict", "unmatched-archive", "ambiguous-archive", "title-conflict",
]);

export function isSelectableStockAction(action: PlanAction) {
  return action.kind !== "unchanged" && !isSoldStockReviewAction(action);
}

export function isApprovableStockAction(action: PlanAction) {
  return !isSoldStockReviewAction(action) && (action.kind === "create" || action.kind === "update");
}

export function isDraftableStockAction(action: PlanAction) {
  if (!action.sourceIdentityKey?.trim() || isSoldStockReviewAction(action)) return false;
  if ((action.kind === "blocked" || action.kind === "conflict") && PROTECTED_DRAFT_REASONS.has(action.reason)) return false;
  if (action.kind === "create" || action.kind === "update" || action.kind === "conflict") return true;
  return action.kind === "blocked" && !PROTECTED_DRAFT_REASONS.has(action.reason) &&
    (Boolean(action.listingId) || action.section === "new");
}

export function selectReviewActions(actions: PlanAction[], indexes: number[]) {
  const selectedIndexes = new Set(indexes);
  if (!indexes.length || indexes.length > MAX_STOCK_REVIEW_SELECTION || selectedIndexes.size !== indexes.length ||
      indexes.some(index => !Number.isInteger(index) || index < 0 || index >= actions.length)) {
    throw new Error("Choose valid listings from this review.");
  }
  return {
    selected: actions.filter((_, index) => selectedIndexes.has(index)),
    remaining: actions.filter((_, index) => !selectedIndexes.has(index)),
  };
}
