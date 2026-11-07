import type { PlanAction } from "./types";

const CORRECTABLE_BLOCK_REASONS = new Set([
  "review-flag",
  "source-conflict",
  "unmatched-archive",
  "ambiguous-archive",
  "missing-required-attr",
  "invalid-price",
  "invalid-title",
  "poa",
  "missing-price",
  "images-not-owned",
  "not-importable",
  "title-conflict",
  "availability-held",
  "source-transmission-conflict",
  "confirm-vehicle-category",
  "supply-owned-photos",
]);

function soldReview(action: PlanAction) {
  if (action.kind === "blocked" && ["sold-exclude-from-live-import", "sold-preserved", "source-sold"].includes(action.reason)) {
    return true;
  }
  return action.review?.availability === "sold" || Boolean(action.review?.flags.includes("sold-exclude-from-live-import"));
}

export function canEditStockReviewAction(action: PlanAction) {
  if (!action.sourceIdentityKey?.trim() || action.listingId || soldReview(action)) return false;
  return action.kind === "create" || action.kind === "blocked";
}

export function canCorrectStockReviewToCreate(action: PlanAction) {
  if (!canEditStockReviewAction(action)) return false;
  if (action.kind === "create") return true;
  return action.kind === "blocked" && action.section === "new" && CORRECTABLE_BLOCK_REASONS.has(action.reason);
}

