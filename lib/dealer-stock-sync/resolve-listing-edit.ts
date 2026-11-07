import { Prisma } from "@prisma/client";
import { fingerprintSnapshot } from "./fingerprint";
import { loadStockSyncSnapshot } from "./snapshot";
import { planAfterCorrection, readPlanActions } from "./review-edit";
import { isSelectableStockAction } from "./selection";

export type LinkedReviewTarget = { reportId: string; fingerprint: string; sourceIdentityKey: string };
const STALE = "This stock review changed. Refresh it before saving the correction.";

/** Run inside the listing edit transaction, before locking the listing. */
export async function prepareLinkedReviewResolution(tx: Prisma.TransactionClient, target: LinkedReviewTarget, listingId: string, actorId: string) {
  const initial = await tx.dealerStockSyncReport.findUnique({ where: { id: target.reportId }, select: { bindingId: true } });
  if (!initial) throw new Error(STALE);
  await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${initial.bindingId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "DealerStockSyncReport" WHERE "id" = ${target.reportId} FOR UPDATE`;
  const report = await tx.dealerStockSyncReport.findUnique({ where: { id: target.reportId } });
  const actions = readPlanActions(report?.plan);
  if (!report || report.status !== "PENDING_REVIEW" || report.fingerprint !== target.fingerprint || !actions) throw new Error(STALE);
  const matches = actions.filter(action => action.sourceIdentityKey === target.sourceIdentityKey);
  const action = matches[0];
  if (matches.length !== 1 || !action || action.listingId !== listingId || !["blocked", "conflict"].includes(action.kind)) throw new Error(STALE);
  await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${report.dealerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "dealerId" = ${report.dealerId} FOR UPDATE`;
  const busy = await tx.dealerStockSyncJob.findFirst({ where: { bindingId: report.bindingId, status: { in: ["QUEUED", "LEASED"] } }, select: { id: true } });
  if (busy) throw new Error("Wait for this dealer's current stock task to finish before saving the correction.");
  const before = await loadStockSyncSnapshot(report.dealerId, actions, tx);
  if (before?.listings.some(listing => listing.id === listingId && (listing.stockReviewHeld || listing.stockDraft))) {
    throw new Error("This listing is tracked as a dealer stock draft. Use its ownership review controls; saving must not remove it from stock review.");
  }
  if (!before || before.binding.id !== report.bindingId || !before.listings.some(listing => listing.id === listingId) ||
      !before.identities.some(identity => identity.sourceIdentityKey === target.sourceIdentityKey && identity.listingId === listingId)) throw new Error(STALE);
  const wasCurrent = fingerprintSnapshot(before) === report.fingerprint;
  const remaining = actions.filter(item => item !== action);

  return async () => {
    const after = await loadStockSyncSnapshot(report.dealerId, remaining, tx);
    if (!after) throw new Error(STALE);
    // Never legitimise unrelated changes in an already-stale report. The selected
    // manual correction can be resolved, but remaining approvals still fail closed.
    const fingerprint = wasCurrent ? fingerprintSnapshot(after) : report.fingerprint;
    const changed = await tx.dealerStockSyncReport.updateMany({
      where: { id: report.id, status: "PENDING_REVIEW", fingerprint: target.fingerprint },
      data: { plan: planAfterCorrection(report.plan, remaining) as Prisma.InputJsonValue, fingerprint,
        status: remaining.some(isSelectableStockAction) ? "PENDING_REVIEW" : "APPLIED" },
    });
    if (changed.count !== 1) throw new Error(STALE);
    await tx.dealerStockSyncAudit.create({ data: {
      reportId: report.id, actorId, action: "admin-stock-review-resolved",
      before: { fingerprint: report.fingerprint, action } as unknown as Prisma.InputJsonValue,
      after: { fingerprint, listingId, remainingCount: remaining.length, preservedStaleGuard: !wasCurrent },
    } });
  };
}
