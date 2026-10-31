import type { Prisma } from "@prisma/client";
import { fingerprintSnapshot } from "./fingerprint";
import { loadStockSyncSnapshot } from "./snapshot";
import { planAfterCorrection } from "./review-edit";
import { isSelectableStockAction } from "./selection";
import type { PlanAction } from "./types";

/** Restore the untouched remainder only after this exact batch commits successfully. */
export async function completeStockReviewSelection(client: Prisma.TransactionClient, report: {
  id: string; dealerId: string; fingerprint: string; plan: unknown;
}) {
  const plan = report.plan as { pendingReviewActions?: unknown } | null;
  if (!plan || !Array.isArray(plan.pendingReviewActions)) return;
  const remaining = plan.pendingReviewActions as PlanAction[];
  const pending = remaining.some(isSelectableStockAction);
  const approved = report.plan as { actions?: PlanAction[] };
  // Completed report history must retain the actual applied vehicle evidence.
  const nextActions = pending ? remaining : [...(approved.actions ?? []), ...remaining];
  const snapshot = await loadStockSyncSnapshot(report.dealerId, nextActions, client);
  if (!snapshot) throw new Error("Stock review could not be refreshed after processing.");
  const nextPlan = planAfterCorrection(report.plan, nextActions);
  delete nextPlan.pendingReviewActions;
  const restored = await client.dealerStockSyncReport.updateMany({
    where: { id: report.id, status: "APPLIED", fingerprint: report.fingerprint },
    data: {
      plan: nextPlan as unknown as Prisma.InputJsonValue,
      fingerprint: fingerprintSnapshot(snapshot),
      status: pending ? "PENDING_REVIEW" : "APPLIED",
      ...(pending ? { approvedAt: null, approvedById: null } : {}),
    },
  });
  if (restored.count !== 1) throw new Error("Stock review changed while processing.");
}
