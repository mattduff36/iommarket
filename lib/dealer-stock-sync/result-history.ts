import { isSoldStockReviewAction } from "./review";
import type { PlanAction } from "./types";
import { isSelectableStockAction } from "./selection";

function hasPendingSelection(plan: unknown) {
  if (!plan || typeof plan !== "object" || !("pendingReviewActions" in plan)) return false;
  return Array.isArray(plan.pendingReviewActions) && plan.pendingReviewActions.some((action: PlanAction) => action && isSelectableStockAction(action));
}

export type ResultHistoryState = "active" | "archived" | "deleted";
export const RESULT_HISTORY_ACTIONS = ["RESULT_ARCHIVED", "RESULT_DELETED", "RESULT_RESTORED"] as const;
export type ResultHistoryAction = typeof RESULT_HISTORY_ACTIONS[number];

export function resultHistoryState(status: string, action: string | null, plan?: unknown): ResultHistoryState {
  if (hasPendingSelection(plan)) return "active";
  if (action === "RESULT_DELETED") return "deleted";
  if (action === "RESULT_ARCHIVED") return "archived";
  if (action === "RESULT_RESTORED") return "active";
  if (status === "SUPERSEDED") return canManageStockReport("PENDING_REVIEW", plan) ? "active" : "archived";
  return ["APPLIED", "REJECTED"].includes(status) ? "archived" : "active";
}

export function canManageStockReport(status: string, plan: unknown): boolean {
  if (hasPendingSelection(plan)) return false;
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
}
