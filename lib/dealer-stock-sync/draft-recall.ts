import { Prisma } from "@prisma/client";
import { z } from "zod";
import { stockDraftReceiptInclude } from "./draft-handoff-store";
import { classifyStockDraftHandoff } from "./draft-handoff";
import { readPlanActions, planAfterCorrection } from "./review-edit";
import { isSoldStockReviewAction } from "./review";
import { assertStoredStockDraftReady } from "./draft-readiness";
import { createListingStatusEvent } from "@/lib/listings/status-events";

const id = z.string().trim().min(1).max(100);
export const stockDraftOwnershipSchema = z.object({
  reportId: id, dealerId: id, receiptId: id, listingId: id,
  sourceIdentityKey: z.string().min(1).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedLifecycleRevision: z.number().int().nonnegative(),
  expectedPhotoRevision: z.number().int().nonnegative(),
  expectedUpdatedAt: z.string().datetime(),
  operation: z.enum(["recall", "moderation"]),
  confirmed: z.literal(true),
}).strict();
export type StockDraftOwnershipInput = z.infer<typeof stockDraftOwnershipSchema>;
export class StockDraftRecallError extends Error {}
const STALE = "This draft or stock review changed. Refresh and check the saved work before trying again.";

/** Caller must authorize an administrator and use a serializable transaction. */
export async function changeStockDraftOwnership(tx: Prisma.TransactionClient, input: StockDraftOwnershipInput, actor: { id: string; role: string }) {
  if (actor.role !== "ADMIN") throw new StockDraftRecallError("Only administrators can pull back stock drafts.");
  const initial = await tx.dealerStockSyncReport.findUnique({ where: { id: input.reportId }, select: { bindingId: true } });
  if (!initial) throw new StockDraftRecallError(STALE);
  await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${initial.bindingId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "DealerStockSyncReport" WHERE "id" = ${input.reportId} FOR UPDATE`;
  const report = await tx.dealerStockSyncReport.findUnique({ where: { id: input.reportId } });
  if (!report || report.dealerId !== input.dealerId || report.bindingId !== initial.bindingId ||
      !["PENDING_REVIEW", "REJECTED", "APPLIED"].includes(report.status)) throw new StockDraftRecallError(STALE);
  await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${report.dealerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${input.listingId} FOR UPDATE`;
  const receipt = await tx.stockReviewDraftReceipt.findUnique({ where: { id: input.receiptId }, include: stockDraftReceiptInclude });
  const origin = receipt && await tx.dealerStockSyncReport.findUnique({ where: { id: receipt.reportId }, select: { bindingId: true, dealerId: true } });
  if (!receipt || !origin || origin.bindingId !== report.bindingId || origin.dealerId !== report.dealerId ||
      receipt.dealerId !== report.dealerId || receipt.listingId !== input.listingId ||
      receipt.sourceIdentityKey !== input.sourceIdentityKey ||
      receipt.listing.stockSourceIdentity?.bindingId !== report.bindingId) throw new StockDraftRecallError(STALE);
  if (receipt.revisionId) throw new StockDraftRecallError("Pull back supports new dealer drafts only. Resolve live-listing revisions through listing moderation; the live listing is unchanged.");
  const handoff = classifyStockDraftHandoff(receipt, receipt.listing.stockSourceIdentity);
  const listing = receipt.listing;
  const actions = readPlanActions(report.plan);
  const matches = actions?.filter(action => action.listingId === listing.id || action.sourceIdentityKey === input.sourceIdentityKey) ?? [];
  if (!handoff || !actions || matches.length > 1 ||
      matches.some(action => action.sourceIdentityKey !== input.sourceIdentityKey || action.listingId !== listing.id ||
        isSoldStockReviewAction(action) || action.kind !== "blocked" ||
        !["status-preserved", "awaiting-dealer-review", "admin-stock-review", "submitted-dealer-review"].includes(action.reason)) ||
      (!matches.length && receipt.reportId !== report.id)) throw new StockDraftRecallError(STALE);
  // A retry of the same completed recall never rewrites the preserved record.
  if (input.operation === "recall" && handoff.state === "admin" && receipt.recalledReportId === report.id) {
    return { listingId: listing.id, dealerId: report.dealerId, alreadyDone: true };
  }
  if (input.operation === "moderation" && handoff.state === "moderation" && listing.stockReviewHeld && receipt.recalledAt) {
    return { listingId: listing.id, dealerId: report.dealerId, alreadyDone: true };
  }
  if (report.fingerprint !== input.fingerprint ||
      listing.lifecycleRevision !== input.expectedLifecycleRevision ||
      listing.photoRevision !== input.expectedPhotoRevision ||
      listing.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new StockDraftRecallError(STALE);
  if (listing.featured || listing.expiresAt ||
      (input.operation === "recall" ? handoff.state !== "dealer" || listing.status !== "DRAFT" : handoff.state !== "admin")) {
    throw new StockDraftRecallError("This draft is submitted, protected or no longer available for this action. Refresh the review.");
  }
  const [binding, dealer, busy, revision, newer, payment, checkout] = await Promise.all([
    tx.dealerStockSourceBinding.findUnique({ where: { id: report.bindingId }, select: { dealerId: true, verifiedAt: true } }),
    tx.dealerProfile.findUnique({ where: { id: report.dealerId }, select: {
      userId: true, isAdminPreview: true, user: { select: { role: true, disabledAt: true, deletedAt: true } },
    } }),
    tx.dealerStockSyncJob.findFirst({ where: { bindingId: report.bindingId, status: { in: ["QUEUED", "LEASED"] } }, select: { id: true } }),
    tx.listingRevision.findFirst({ where: { listingId: listing.id, status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } }),
    tx.dealerStockSyncReport.findFirst({ where: { bindingId: report.bindingId, id: { not: report.id }, status: { in: ["PENDING_REVIEW", "APPROVED", "APPLIED", "REJECTED"] }, createdAt: { gt: report.createdAt } }, select: { id: true } }),
    tx.payment.findFirst({ where: { listingId: listing.id, refundedAt: null, status: { in: ["PENDING", "SUCCEEDED"] } }, select: { id: true } }),
    tx.sampleCheckout.findFirst({ where: { targetId: listing.id, kind: { in: ["listing_payment", "listing_and_featured", "featured_upgrade"] }, status: { in: ["PENDING", "SUCCEEDED"] } }, select: { id: true } }),
  ]);
  // Manual stock review remains available when automatic scraping is disabled.
  if (!binding?.verifiedAt || binding.dealerId !== report.dealerId || !dealer ||
      dealer.userId !== receipt.userId || dealer.isAdminPreview || dealer.user.role !== "DEALER" ||
      dealer.user.disabledAt || dealer.user.deletedAt || revision || newer) throw new StockDraftRecallError(STALE);
  if (busy) throw new StockDraftRecallError("Wait for this dealer's current stock task to finish before changing draft ownership.");
  if (payment || checkout) throw new StockDraftRecallError("This draft has a pending or successful payment. Resolve its payment state before changing draft ownership.");
  const now = new Date();
  if (input.operation === "moderation") {
    await assertStoredStockDraftReady(tx, { listingId: listing.id, adminReview: true });
  }
  const changed = await tx.listing.updateMany({
    where: {
      id: listing.id, dealerId: report.dealerId, userId: receipt.userId, status: listing.status,
      lifecycleRevision: input.expectedLifecycleRevision, photoRevision: input.expectedPhotoRevision,
      updatedAt: new Date(input.expectedUpdatedAt), stockReviewHeld: input.operation === "moderation",
      soldAt: null, featured: false, previewPackId: null, retentionPurgedAt: null,
    },
    data: { stockReviewHeld: true, lifecycleRevision: { increment: 1 }, ...(input.operation === "moderation" ? { status: "PENDING" } : {}) },
  });
  if (changed.count !== 1) throw new StockDraftRecallError(STALE);
  if (input.operation === "recall") {
    const marked = await tx.stockReviewDraftReceipt.updateMany({
      where: { id: receipt.id, recalledAt: null, listingId: listing.id, revisionId: null },
      data: { recalledAt: now, recalledById: actor.id, recalledReportId: report.id },
    });
    if (marked.count !== 1) throw new StockDraftRecallError(STALE);
  } else {
    await createListingStatusEvent({
      listingId: listing.id, fromStatus: listing.status, toStatus: "PENDING", action: "SUBMIT",
      source: "ADMIN", changedByUserId: actor.id, notes: "Admin reviewed recalled dealer stock; sent to listing moderation without publishing.",
    }, tx);
  }
  const nextActions = matches.length ? actions.map(action => matches.includes(action)
    ? { ...action, kind: "blocked" as const, section: "change" as const, reason: input.operation === "recall" ? "admin-stock-review" : "submitted-dealer-review" }
    : action) : [...actions, {
      kind: "blocked" as const, section: "change" as const, listingId: listing.id,
      sourceIdentityKey: input.sourceIdentityKey, displayTitle: listing.title,
      reason: input.operation === "recall" ? "admin-stock-review" : "submitted-dealer-review",
    }];
  const saved = await tx.dealerStockSyncReport.updateMany({
    where: { id: report.id, fingerprint: report.fingerprint, status: report.status },
    data: { status: "PENDING_REVIEW", plan: planAfterCorrection(report.plan, nextActions) as Prisma.InputJsonValue },
  });
  if (saved.count !== 1) throw new StockDraftRecallError(STALE);
  // Deliberately do not rebase the report fingerprint: unrelated stale proposals remain stale.
  await tx.dealerStockSyncAudit.create({ data: {
    reportId: report.id, actorId: actor.id, action: input.operation === "recall" ? "admin-recall-dealer-draft" : "admin-submit-recalled-draft",
    before: { receiptId: receipt.id, originReportId: receipt.reportId, listingId: listing.id,
      sourceIdentityKey: input.sourceIdentityKey, status: listing.status, lifecycleRevision: listing.lifecycleRevision,
      photoRevision: listing.photoRevision, updatedAt: listing.updatedAt.toISOString() },
    after: { status: input.operation === "recall" ? "DRAFT" : "PENDING", stockReviewHeld: true,
      preservedListingAndPhotos: true, preservedStaleGuard: true, fingerprint: report.fingerprint,
      adminReviewConfirmed: input.operation === "moderation" },
  } });
  return { listingId: listing.id, dealerId: report.dealerId, alreadyDone: false };
}
