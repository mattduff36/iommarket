import { db } from "@/lib/db";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { parseRippleReference } from "@/lib/payments/ripple-reference";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import { reconcileHostedSubscriptionReturn } from "@/lib/payments/reconcile-hosted-subscription-return";
import { recordHostedReturnObservation } from "@/lib/payments/checkout-attempts";

// The caller verifies the signed cookie, authentication and confirmed auth email.
export type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
export type HostedReturnResult = { status: "confirmed"; listingId?: string; checkoutType?: "listing_payment" | "listing_and_featured" | "featured_upgrade" | "dealer_subscription" } | { status: "waiting" | "review" };
const MAX_AGE = 30 * 60_000;

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
  const observation = await recordHostedReturnObservation({
    merchantReference: context.merchantReference,
    userId: context.userId,
    providerPaymentId: paymentJobRef,
  });
  if (observation?.conflicts) return { status: "review" };

  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: context.paymentId },
      include: { listing: { select: { userId: true } } },
    });
    if (
      !payment ||
      payment.listingId !== context.listingId ||
      payment.listing.userId !== context.userId ||
      payment.providerReference !== context.merchantReference ||
      payment.paymentProvider !== "RIPPLE" ||
      payment.type !== paymentType ||
      payment.amount !== product.amountPence ||
      payment.currency !== "gbp" ||
      payment.includesFeatured !== (checkoutType === "listing_and_featured") ||
      payment.refundedAt ||
      !["PENDING", "SUCCEEDED"].includes(payment.status)
    ) {
      return { status: "review" as const };
    }

    const receipts = await tx.paymentWebhookInbox.findMany({
      where: { paymentReference: paymentJobRef },
    });
    if (receipts.some((row) => row.eventType !== "payment.received")) {
      return { status: "review" as const };
    }
    const assigned = await tx.payment.findUnique({
      where: { providerPaymentId: paymentJobRef },
    });
    const subscriptionCharge = await tx.subscriptionCharge.findUnique({
      where: { paymentReference: paymentJobRef },
    });
    if (subscriptionCharge || (assigned && assigned.id !== payment.id)) {
      return { status: "review" as const };
    }
    if (payment.status === "SUCCEEDED") {
      return payment.providerPaymentId === paymentJobRef &&
        assigned?.id === payment.id
        ? {
            status: "confirmed" as const,
            listingId: payment.listingId,
            ...(checkoutType === "featured_upgrade" ? { checkoutType } : {}),
          }
        : { status: "review" as const };
    }
    if (payment.providerPaymentId || receipts.length > 1) {
      return { status: "review" as const };
    }
    if (
      receipts.length === 0 ||
      receipts.some((row) =>
        ["PENDING", "PROCESSING"].includes(row.status),
      )
    ) {
      return { status: "waiting" as const };
    }
    return { status: "review" as const };
  });
}
