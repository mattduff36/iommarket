"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { dealerSyncBlockReason } from "@/lib/dealer-stock-sync/eligibility";
import { fingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import { loadStockSyncSnapshot } from "@/lib/dealer-stock-sync/snapshot";
import { readPlanActions, planAfterCorrection } from "@/lib/dealer-stock-sync/review-edit";
import { isApprovableStockAction, isDraftableStockAction, isSelectableStockAction, selectReviewActions, MAX_STOCK_REVIEW_SELECTION, MAX_STOCK_DRAFT_SELECTION } from "@/lib/dealer-stock-sync/selection";
import { transferStockDrafts } from "@/lib/dealer-stock-sync/draft-transfer";
import { enqueueApplyJob } from "@/lib/dealer-stock-sync/enqueue";
import { notifyReceivedDraftListings } from "@/lib/email/draft-listing-notifications";
import { captureException } from "@/lib/monitoring";

const schema = z.object({
  reportId: z.string().trim().min(1).max(64), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operation: z.enum(["approve", "reject", "draft"]),
  actionIndexes: z.array(z.number().int().min(0).max(MAX_STOCK_REVIEW_SELECTION - 1)).min(1).max(MAX_STOCK_REVIEW_SELECTION),
}).strict();
const STALE = "This review changed. Refresh it and select the listings again.";

export async function reviewDealerStockSelection(input: unknown) {
  const admin = await requireRole("ADMIN");
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return { error: availability.reason ?? "Stock review is unavailable." };
  const limited = await checkRateLimit(`dealer-stock-sync:${admin.id}`, { windowMs: 60_000, maxRequests: 20, policy: "dealer-stock-sync" });
  if (!limited.allowed) return { error: "Too many stock review requests. Try again shortly." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Choose valid listings from the current review." };
  if (parsed.data.operation === "draft" && parsed.data.actionIndexes.length > MAX_STOCK_DRAFT_SELECTION) {
    return { error: `Send up to ${MAX_STOCK_DRAFT_SELECTION} listings to dealer drafts at a time. Select a smaller batch.` };
  }
  try {
    const result = await db.$transaction(async tx => {
      const initial = await tx.dealerStockSyncReport.findUnique({ where: { id: parsed.data.reportId }, select: { bindingId: true } });
      if (!initial) return { error: STALE };
      await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${initial.bindingId} FOR UPDATE`;
      const report = await tx.dealerStockSyncReport.findUnique({ where: { id: parsed.data.reportId } });
      if (!report || report.status !== "PENDING_REVIEW" || report.fingerprint !== parsed.data.fingerprint) return { error: STALE };
      await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${report.dealerId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "dealerId" = ${report.dealerId} FOR UPDATE`;
      const actions = readPlanActions(report.plan);
      if (!actions) return { error: STALE };
      const snapshot = await loadStockSyncSnapshot(report.dealerId, actions, tx);
      if (!snapshot || snapshot.binding.id !== report.bindingId) return { error: STALE };
      if (fingerprintSnapshot(snapshot) !== report.fingerprint) {
        return { error: "Stock has changed since this scan. Run a new stock check for this dealer, then review the new results." };
      }
      if (dealerSyncBlockReason({ ...snapshot.dealer, role: snapshot.dealer.role as "USER" | "DEALER" | "ADMIN" })) {
        return { error: "This dealer account cannot receive stock changes." };
      }
      const busy = await tx.dealerStockSyncJob.findFirst({ where: { bindingId: report.bindingId, status: { in: ["QUEUED", "LEASED"] } }, select: { id: true } });
      if (busy) return { error: "Wait for this dealer's current stock task to finish before changing the review." };
      const { selected, remaining } = selectReviewActions(actions, parsed.data.actionIndexes);
      if (selected.some(action => !isSelectableStockAction(action))) return { error: "Sold or unchanged vehicles cannot be selected." };
      if (parsed.data.operation === "approve" && selected.some(action => !isApprovableStockAction(action))) {
        return { error: "Only eligible new listings and updates can be approved. Blocked vehicles and suggested removals are not approved by this action." };
      }
      if (parsed.data.operation === "draft" && selected.some(action => !isDraftableStockAction(action))) {
        return { error: "One of these vehicles has protected stock or an identity conflict. Resolve it as an administrator before sending drafts." };
      }
      if (parsed.data.operation === "draft" && snapshot.activeListingCount + selected.filter(action => !action.listingId).length > snapshot.listingCap) {
        return { error: "These new drafts would exceed the dealer's listing allowance. Select fewer vehicles or free up space first." };
      }
      const drafts = parsed.data.operation === "draft" ? await transferStockDrafts(tx, {
        reportId: report.id, fingerprint: report.fingerprint, snapshot, actions, indexes: parsed.data.actionIndexes,
      }) : [];
      const nextActions = parsed.data.operation === "approve" ? selected : remaining;
      const nextSnapshot = parsed.data.operation === "draft"
        ? await loadStockSyncSnapshot(report.dealerId, nextActions, tx) : { ...snapshot, actions: nextActions };
      if (!nextSnapshot) throw new Error("Stock snapshot unavailable.");
      const fingerprint = fingerprintSnapshot(nextSnapshot);
      const nextPlan = { ...planAfterCorrection(report.plan, nextActions),
        ...(parsed.data.operation === "approve" ? { pendingReviewActions: remaining } : {}),
      };
      const changed = await tx.dealerStockSyncReport.updateMany({
        where: { id: report.id, status: "PENDING_REVIEW", fingerprint: report.fingerprint },
        data: {
          plan: nextPlan as unknown as Prisma.InputJsonValue, fingerprint,
          status: parsed.data.operation === "approve" ? "APPROVED" : remaining.some(isSelectableStockAction) ? "PENDING_REVIEW" : "REJECTED",
          ...(parsed.data.operation === "approve" ? { approvedAt: new Date(), approvedById: admin.id } : {}),
        },
      });
      if (changed.count !== 1) throw new Error(STALE);
      const job = parsed.data.operation === "approve" ? await enqueueApplyJob(tx, {
        bindingId: report.bindingId, dealerId: report.dealerId, reportId: report.id, fingerprint, actorId: admin.id, reviewSelection: true,
      }) : null;
      const audit = await tx.dealerStockSyncAudit.create({ data: {
        reportId: report.id, actorId: admin.id, action: `review-selection-${parsed.data.operation}`,
        before: { fingerprint: report.fingerprint, actions: selected } as unknown as Prisma.InputJsonValue,
        after: { fingerprint, remainingCount: remaining.length, drafts, jobId: job?.id ?? null } as unknown as Prisma.InputJsonValue,
      } });
      return { data: {
        dealerId: report.dealerId, userId: snapshot.dealer.userId, count: selected.length,
        fingerprint, operation: parsed.data.operation, jobId: job?.id ?? null, deliveryKey: audit.id,
      } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    if (!result.data) return result;
    let warning: string | undefined;
    if (result.data.operation === "draft") {
      try { await notifyReceivedDraftListings(result.data); }
      catch {
        warning = "Drafts were saved, but the notification could not be sent.";
        await captureException({ source: "SERVER", error: new Error("Stock draft notification delivery failed"), action: "stock-draft-notification", tags: { deliveryKey: result.data.deliveryKey } }).catch(() => undefined);
      }
    }
    for (const path of ["/admin/stock-reviews", `/admin/dealers/${result.data.dealerId}/stock-sync`, "/account/listings", "/dealer/dashboard"]) revalidatePath(path);
    return { data: result.data, ...(warning ? { warning } : {}) };
  } catch {
    return { error: "The selected stock review changes could not be saved. Refresh and try again." };
  }
}
