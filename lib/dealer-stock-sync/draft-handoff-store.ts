import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyStockDraftHandoff, decorateStockDraftActions } from "./draft-handoff";
import { readPlanActions } from "./review-edit";

export const stockDraftReceiptInclude = {
  revision: { select: { id: true, listingId: true, status: true, version: true } },
  listing: { select: {
    id: true, dealerId: true, userId: true, status: true, stockReviewHeld: true, title: true,
    soldAt: true, previewPackId: true, retentionPurgedAt: true,
    lifecycleRevision: true, photoRevision: true, updatedAt: true,
    featured: true, expiresAt: true,
    stockSourceIdentity: { select: { sourceIdentityKey: true, listingId: true, bindingId: true } },
  } },
} as const;

export async function loadStockDraftHandoffs(dealerId: string, bindingId: string, client: Prisma.TransactionClient = db) {
  const receipts = await client.stockReviewDraftReceipt.findMany({
    where: { dealerId }, include: stockDraftReceiptInclude, orderBy: { createdAt: "desc" },
  });
  return receipts.flatMap(receipt => {
    const identity = receipt.listing.stockSourceIdentity;
    const handoff = identity?.bindingId === bindingId ? classifyStockDraftHandoff(receipt, identity) : null;
    return handoff ? [handoff] : [];
  }).filter((item, index, all) => all.findIndex(other => other.listingId === item.listingId && other.revisionId === item.revisionId) === index);
}

export async function decorateStockDraftReports<T extends { id: string; dealerId: string; bindingId: string; plan: unknown }>(
  reports: T[], client: Prisma.TransactionClient = db,
) {
  const dealers = [...new Map(reports.map(report => [report.dealerId, report.bindingId])).entries()];
  const handoffs = new Map(await Promise.all(dealers.map(async ([dealerId, bindingId]) =>
    [dealerId, await loadStockDraftHandoffs(dealerId, bindingId, client)] as const)));
  return reports.map(report => {
    const actions = readPlanActions(report.plan);
    if (!actions || !report.plan || typeof report.plan !== "object" || Array.isArray(report.plan)) return report;
    const current = handoffs.get(report.dealerId) ?? [];
    const pending = "pendingReviewActions" in report.plan && Array.isArray(report.plan.pendingReviewActions)
      ? report.plan.pendingReviewActions as import("./types").PlanAction[] : null;
    // Original action indexes stay stable. History belongs after the primary action list.
    return { ...report, plan: { ...report.plan,
      actions: decorateStockDraftActions(actions, current.filter(item => !pending?.some(action => action.listingId === item.listingId)), report.id),
      ...(pending ? { pendingReviewActions: decorateStockDraftActions(pending, current, "") } : {}),
    } };
  });
}
