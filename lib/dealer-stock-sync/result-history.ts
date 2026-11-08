import { z } from "zod";
import { isSoldStockReviewAction } from "./review";
import type { PlanAction } from "./types";
import { isSelectableStockAction } from "./selection";
import { isStockDraftOwnedAction } from "./draft-handoff";

const noChangeBase = z.object({
  sourceIdentityKey: z.string().min(1).nullable(), listingId: z.string().min(1).nullable(),
  stockDraft: z.never().optional(),
  review: z.object({ availability: z.enum(["available", "reserved", "sold", "unknown"]), flags: z.array(z.string()) }).optional(),
});
const noChangeAction = z.union([
  noChangeBase.extend({ kind: z.literal("unchanged"), sourceIdentityKey: z.string().min(1) }),
  noChangeBase.extend({ kind: z.literal("blocked"), reason: z.string().min(1), section: z.enum(["new", "missing", "change", "other"]) })
    .refine(action => !isStockDraftOwnedAction({ ...action, review: undefined }) &&
      (["sold", "source-sold", "sold-preserved", "sold-exclude-from-live-import"].includes(action.reason) ||
        action.review?.availability === "sold" || Boolean(action.review?.flags.includes("sold-exclude-from-live-import")))),
]);
const noChangePlan = z.object({ actions: z.array(noChangeAction), pendingReviewActions: z.array(noChangeAction).optional() });

export function isGenuineNoChangeReview(status: string, plan: unknown): boolean {
  return ["PENDING_REVIEW", "SUPERSEDED", "REJECTED"].includes(status) && noChangePlan.safeParse(plan).success;
}

function hasPendingSelection(plan: unknown) {
  if (!plan || typeof plan !== "object" || !("pendingReviewActions" in plan)) return false;
  return Array.isArray(plan.pendingReviewActions) && plan.pendingReviewActions.some((action: PlanAction) => action && isSelectableStockAction(action));
}

function hasDraftOwnership(plan: unknown) {
  if (!plan || typeof plan !== "object") return false;
  const groups = ["actions" in plan ? plan.actions : null, "pendingReviewActions" in plan ? plan.pendingReviewActions : null];
  return groups.some(group => Array.isArray(group) && group.some((action: PlanAction) => action && isStockDraftOwnedAction(action)));
}

export type ResultHistoryState = "active" | "archived" | "deleted";
export const RESULT_HISTORY_ACTIONS = ["RESULT_ARCHIVED", "RESULT_DELETED", "RESULT_RESTORED"] as const;
export type ResultHistoryAction = typeof RESULT_HISTORY_ACTIONS[number];

export function resultHistoryState(status: string, action: string | null, plan?: unknown): ResultHistoryState {
  if (isGenuineNoChangeReview(status, plan)) return action === "RESULT_DELETED" ? "deleted" : "archived";
  // Superseded snapshots no longer own review work. Keep explicit history choices
  // even when their saved plan still contains selections or tracked drafts.
  if (status === "SUPERSEDED") {
    if (action === "RESULT_DELETED") return "deleted";
    if (action === "RESULT_ARCHIVED") return "archived";
    if (action === "RESULT_RESTORED") return "active";
  }
  if (hasPendingSelection(plan) || hasDraftOwnership(plan)) return "active";
  if (action === "RESULT_DELETED") return "deleted";
  if (action === "RESULT_ARCHIVED") return "archived";
  if (action === "RESULT_RESTORED") return "active";
  if (status === "SUPERSEDED") return canManageStockReport("PENDING_REVIEW", plan) ? "active" : "archived";
  return ["APPLIED", "REJECTED"].includes(status) ? "archived" : "active";
}

export function canManageStockReport(status: string, plan: unknown): boolean {
  if (status === "SUPERSEDED") return true;
  if (hasPendingSelection(plan) || hasDraftOwnership(plan)) return false;
  if (["APPLIED", "FAILED", "REJECTED", "SUPERSEDED"].includes(status)) return true;
  if (status !== "PENDING_REVIEW" || !plan || typeof plan !== "object" || !("actions" in plan)) return false;
  if (!Array.isArray(plan.actions)) return false;
  return plan.actions.every((action: PlanAction) =>
    action && typeof action.kind === "string" &&
    (["unchanged", "missing_once"].includes(action.kind) || isSoldStockReviewAction(action)));
}

export interface ResultHistoryEntry {
  id: string;
  kind: "report" | "job";
  state: ResultHistoryState;
  manageable: boolean;
  restoreState?: "archived";
}
