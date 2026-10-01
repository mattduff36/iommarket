import { db } from "@/lib/db";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import { captureBusinessEvent } from "@/lib/monitoring";
import { eventFromMinimizedPayload, type RippleMinimizedPayload } from "@/lib/payments/ripple-contract";
import { getRippleClientId, RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { normalizeRippleEmail, parseRippleReference } from "@/lib/payments/ripple-reference";
import { createOrUpdateListingPayment, submitPaidListingForReview } from "@/lib/payments/webhook-payments";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import { reconcileHostedSubscriptionReturn } from "@/lib/payments/reconcile-hosted-subscription-return";

// The caller verifies the signed cookie, authentication and confirmed auth email.
export type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
export type HostedReturnResult = { status: "confirmed"; listingId?: string; checkoutType?: "listing_payment" | "listing_and_featured" | "featured_upgrade" | "dealer_subscription" } | { status: "waiting" | "review" };
const MAX_AGE = 30 * 60_000;
class ClaimChangedError extends Error {}

export async function reconcileHostedReturn(context: HostedReturnContext, paymentJobRef: string): Promise<HostedReturnResult> {
  const now = Date.now();
  if (context.kind === "dealer_subscription") return reconcileHostedSubscriptionReturn(context, paymentJobRef);
  const checkoutType = context.kind ?? "listing_payment";
  const product = context.kind === "featured_upgrade" || context.kind === "listing_and_featured"
    ? getRippleProductByLinkCode(context.productCode) : RIPPLE_CANONICAL_PRODUCTS.listing;
  if (!product || product.checkoutType !== checkoutType) return { status: "review" };
  const paymentType = checkoutType === "featured_upgrade" ? "FEATURED" : "LISTING";
  if (!/^\d{1,64}$/.test(paymentJobRef) || !Number.isFinite(context.issuedAt) ||
      context.issuedAt > now || now - context.issuedAt > MAX_AGE || !context.email) return { status: "review" };
  try {
    const claims = parseRippleReference(context.merchantReference, product.code);
    if (claims?.purpose !== checkoutType || claims.targetId !== context.listingId) return { status: "review" };
  } catch { return { status: "review" }; }

  try {
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: context.paymentId }, include: { listing: { select: { userId: true } } } });
      if (!payment || payment.listingId !== context.listingId || payment.listing.userId !== context.userId ||
          payment.providerReference !== context.merchantReference || payment.paymentProvider !== "RIPPLE" ||
          payment.type !== paymentType || payment.amount !== product.amountPence || payment.currency !== "gbp" ||
          payment.includesFeatured !== (checkoutType === "listing_and_featured") ||
          payment.refundedAt || !["PENDING", "SUCCEEDED"].includes(payment.status)) return { status: "review" as const };

      const receipts = await tx.paymentWebhookInbox.findMany({ where: { paymentReference: paymentJobRef } });
      // A stored adverse event always blocks recovery, including one not processed yet.
      // Ripple currently does not promise refund events; freshness is not proof of current provider balance.
      if (receipts.some((row) => row.eventType !== "payment.received")) return { status: "review" as const };
      const assigned = await tx.payment.findUnique({ where: { providerPaymentId: paymentJobRef } });
      const subscriptionCharge = await tx.subscriptionCharge.findUnique({ where: { paymentReference: paymentJobRef } });
      if (subscriptionCharge || (assigned && assigned.id !== payment.id)) return { status: "review" as const };
      if (payment.status === "SUCCEEDED") {
        return payment.providerPaymentId === paymentJobRef && assigned?.id === payment.id
          ? { status: "confirmed" as const, listingId: payment.listingId }
          : { status: "review" as const };
      }
      if (payment.providerPaymentId) return { status: "review" as const };
      const pendingCount = await tx.payment.count({ where: { status: "PENDING", type: paymentType, paymentProvider: "RIPPLE", listing: { userId: context.userId } } });
      if (pendingCount !== 1) return { status: "review" as const };
      if (receipts.length === 0) return { status: "waiting" as const };
      if (receipts.length !== 1) return { status: "review" as const };
      const inbox = receipts[0];
      if (["PENDING", "PROCESSING"].includes(inbox.status)) return { status: "waiting" as const };
      if (inbox.status !== "FAILED" || inbox.lastErrorCode !== "MISSING_REFERENCE") return { status: "review" as const };
      const raw = inbox.minimizedPayload;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "review" as const };
      const minimized = raw as unknown as RippleMinimizedPayload;
      const clientId = getRippleClientId();
      const earliest = context.issuedAt - 5_000;
      if (inbox.clientId !== clientId || minimized.client_id !== clientId ||
          inbox.paymentReference !== paymentJobRef || minimized.payment_reference !== paymentJobRef ||
          minimized.event !== "payment.received" || inbox.merchantReference || minimized.merchant_reference ||
          inbox.linkCode !== product.code || minimized.link_code !== product.code ||
          inbox.amountPence !== product.amountPence || minimized.amount !== product.amountPence / 100 ||
          inbox.currency?.toLowerCase() !== "gbp" || minimized.currency?.toLowerCase() !== "gbp" ||
          inbox.recurring !== false || minimized.recurring !== false ||
          inbox.linkType !== "one-off" || minimized.link_type !== "one-off" ||
          !inbox.customerEmailNorm || normalizeRippleEmail(inbox.customerEmailNorm) !== normalizeRippleEmail(context.email) ||
          inbox.eventTimestamp.getTime() < earliest || inbox.eventTimestamp.getTime() > now + 5_000 ||
          inbox.createdAt.getTime() < earliest || inbox.createdAt.getTime() > now + 5_000 ||
          new Date(minimized.timestamp).getTime() !== inbox.eventTimestamp.getTime()) return { status: "review" as const };

      const event = eventFromMinimizedPayload({ minimized: { ...minimized, merchant_reference: context.merchantReference }, customerEmailNorm: inbox.customerEmailNorm });
      if (event.metadata.listingId !== context.listingId || event.metadata.checkoutType !== checkoutType || event.paymentStatus !== "SUCCEEDED") return { status: "review" as const };
      const claimed = await tx.paymentWebhookInbox.updateMany({ where: { id: inbox.id, status: "FAILED", lastErrorCode: "MISSING_REFERENCE", attemptCount: inbox.attemptCount }, data: { status: "PROCESSING", lastErrorCode: null, attemptCount: { increment: 1 } } });
      if (claimed.count !== 1) throw new ClaimChangedError();
      const reserved = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", providerPaymentId: null, providerReference: context.merchantReference, refundedAt: null }, data: { providerPaymentId: paymentJobRef } });
      if (reserved.count !== 1) throw new ClaimChangedError();
      const applied = await createOrUpdateListingPayment(event, "SUCCEEDED", tx);
      if (!applied?.applied) throw new ClaimChangedError();
      if (checkoutType === "featured_upgrade") {
        const { applyPaidFeaturedEntitlement } = await import("@/lib/payments/featured-entitlement");
        await applyPaidFeaturedEntitlement(payment.listingId, tx);
      }
      const notifications = checkoutType === "listing_payment" || checkoutType === "listing_and_featured" ? await submitPaidListingForReview(payment.listingId, event, tx) : [];
      const completed = await tx.paymentWebhookInbox.updateMany({ where: { id: inbox.id, status: "PROCESSING", attemptCount: inbox.attemptCount + 1 }, data: { status: "PROCESSED", processedAt: new Date(), lastErrorCode: null } });
      if (completed.count !== 1) throw new ClaimChangedError();
      return { status: "confirmed" as const, listingId: payment.listingId, notifications };
    }, { isolationLevel: "Serializable" });
    if ("notifications" in result && result.notifications?.length) {
      try { await dispatchListingNotifications(result.notifications); }
      catch {
        try { await captureBusinessEvent({ source: "BUSINESS", severity: "HIGH", title: "Listing notification failed after payment", message: "Hosted return reconciliation committed but its notification failed.", action: "reconcileHostedReturn", route: "/pay/success", requestPath: "/pay/success", tags: { checkoutType: "listing_payment" } }); } catch { /* Payment is already committed. */ }
      }
    }
    return result.status === "confirmed" ? { status: "confirmed", listingId: result.listingId, ...(checkoutType === "featured_upgrade" ? { checkoutType } : {}) } : { status: result.status };
  } catch (error) {
    if (error instanceof ClaimChangedError || (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code)))) return { status: "waiting" };
    throw error;
  }
}
