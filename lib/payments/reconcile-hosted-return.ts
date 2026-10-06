import type { PaymentWebhookInbox } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import type { ListingNotificationIntent } from "@/lib/listings/notification-intents";
import { captureBusinessEvent } from "@/lib/monitoring";
import { recordHostedReturnObservation } from "@/lib/payments/checkout-attempts";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import {
  PaymentReconciliationError,
  reconcileListingPaymentInTransaction,
} from "@/lib/payments/reconcile-payment";
import { reconcileHostedSubscriptionReturn } from "@/lib/payments/reconcile-hosted-subscription-return";
import { getRippleClientId, RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import {
  eventFromMinimizedPayload,
  type RippleMinimizedPayload,
} from "@/lib/payments/ripple-contract";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import { normalizeRippleEmail, parseRippleReference } from "@/lib/payments/ripple-reference";

// The caller verifies the signed cookie, authentication and confirmed auth email.
export type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
export type HostedReturnResult = {
  status: "confirmed";
  listingId?: string;
  checkoutType?: "listing_payment" | "listing_and_featured" | "featured_upgrade" | "dealer_subscription";
} | { status: "waiting" | "review" };

const MAX_AGE = 30 * 60_000;
const CLOCK_SKEW_MS = 5_000;

class ClaimChangedError extends Error {}

type ListingCheckout = Exclude<HostedReturnContext, { kind: "dealer_subscription" }>;
type ListingCheckoutType = "listing_payment" | "listing_and_featured" | "featured_upgrade";
type TransactionResult =
  | { status: "waiting" | "review" }
  | { status: "confirmed"; listingId: string; notifications: ListingNotificationIntent[] };

function isMinimizedPayload(value: unknown): value is RippleMinimizedPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function samePounds(amount: number | null, amountPence: number) {
  return amount !== null && Math.round(amount * 100) === amountPence;
}

/**
 * A browser paymentjobref is not payment proof. It may complete a checkout only
 * when it matches one verified Ripple receipt that failed solely because Ripple
 * omitted the signed merchant reference.
 */
function missingReferenceReceipt(input: {
  inbox: PaymentWebhookInbox;
  paymentJobRef: string;
  productCode: string;
  amountPence: number;
  email: string;
  earliest: number;
  now: number;
}): RippleMinimizedPayload | null {
  const { inbox, paymentJobRef, productCode, amountPence, email, earliest, now } = input;
  if (inbox.status !== "FAILED" || inbox.lastErrorCode !== "MISSING_REFERENCE") return null;
  if (!isMinimizedPayload(inbox.minimizedPayload)) return null;
  const minimized = inbox.minimizedPayload;
  const clientId = getRippleClientId();
  const eventAt = new Date(minimized.timestamp).getTime();
  const matches = (
    inbox.clientId === clientId &&
    minimized.client_id === clientId &&
    inbox.paymentReference === paymentJobRef &&
    minimized.payment_reference === paymentJobRef &&
    minimized.event === "payment.received" &&
    !inbox.merchantReference &&
    !minimized.merchant_reference &&
    inbox.linkCode === productCode &&
    minimized.link_code === productCode &&
    inbox.amountPence === amountPence &&
    samePounds(minimized.amount, amountPence) &&
    inbox.currency?.toLowerCase() === "gbp" &&
    minimized.currency?.toLowerCase() === "gbp" &&
    inbox.recurring === false &&
    minimized.recurring === false &&
    inbox.linkType === "one-off" &&
    minimized.link_type === "one-off" &&
    Boolean(inbox.customerEmailNorm) &&
    normalizeRippleEmail(inbox.customerEmailNorm ?? "") === normalizeRippleEmail(email) &&
    inbox.eventTimestamp.getTime() >= earliest &&
    inbox.eventTimestamp.getTime() <= now + CLOCK_SKEW_MS &&
    inbox.createdAt.getTime() >= earliest &&
    inbox.createdAt.getTime() <= now + CLOCK_SKEW_MS &&
    eventAt === inbox.eventTimestamp.getTime()
  );
  return matches ? minimized : null;
}

function isClaimConflict(error: unknown) {
  if (error instanceof ClaimChangedError) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["P2002", "P2034"].includes(String(error.code));
}

export async function reconcileHostedReturn(
  context: HostedReturnContext,
  paymentJobRef: string,
): Promise<HostedReturnResult> {
  const now = Date.now();
  if (context.kind === "dealer_subscription") {
    return reconcileHostedSubscriptionReturn(context, paymentJobRef);
  }
  const checkoutType: ListingCheckoutType = context.kind ?? "listing_payment";
  const product = context.kind === "featured_upgrade" || context.kind === "listing_and_featured"
    ? getRippleProductByLinkCode(context.productCode)
    : RIPPLE_CANONICAL_PRODUCTS.listing;
  if (!product || product.checkoutType !== checkoutType) return { status: "review" };
  const paymentType = checkoutType === "featured_upgrade" ? "FEATURED" : "LISTING";
  if (
    !/^\d{1,64}$/.test(paymentJobRef) ||
    !Number.isFinite(context.issuedAt) ||
    context.issuedAt > now ||
    now - context.issuedAt > MAX_AGE ||
    !context.email
  ) {
    return { status: "review" };
  }
  try {
    const claims = parseRippleReference(context.merchantReference, product.code);
    if (claims?.purpose !== checkoutType || claims.targetId !== context.listingId) {
      return { status: "review" };
    }
  } catch {
    return { status: "review" };
  }
  const observation = await recordHostedReturnObservation({
    merchantReference: context.merchantReference,
    userId: context.userId,
    providerPaymentId: paymentJobRef,
  });
  if (observation?.conflicts) return { status: "review" };

  try {
    const result = await completeListedHostedReturn({
      context,
      paymentJobRef,
      checkoutType,
      paymentType,
      productCode: product.code,
      amountPence: product.amountPence,
      now,
    });
    if (result.status === "confirmed" && result.notifications.length > 0) {
      await dispatchReturnNotifications(result.notifications, checkoutType);
    }
    if (result.status !== "confirmed") return result;
    return {
      status: "confirmed",
      listingId: result.listingId,
      ...(checkoutType === "featured_upgrade" ? { checkoutType } : {}),
    };
  } catch (error) {
    if (error instanceof PaymentReconciliationError) return { status: "review" };
    if (isClaimConflict(error)) return { status: "waiting" };
    throw error;
  }
}

async function completeListedHostedReturn(input: {
  context: ListingCheckout;
  paymentJobRef: string;
  checkoutType: ListingCheckoutType;
  paymentType: "LISTING" | "FEATURED";
  productCode: string;
  amountPence: number;
  now: number;
}): Promise<TransactionResult> {
  const { context, paymentJobRef, checkoutType, paymentType, productCode, amountPence, now } = input;
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
      payment.amount !== amountPence ||
      payment.currency !== "gbp" ||
      payment.includesFeatured !== (checkoutType === "listing_and_featured") ||
      payment.refundedAt ||
      !["PENDING", "SUCCEEDED"].includes(payment.status)
    ) {
      return { status: "review" };
    }

    const receipts = await tx.paymentWebhookInbox.findMany({
      where: { paymentReference: paymentJobRef },
    });
    if (receipts.some((row) => row.eventType !== "payment.received")) {
      return { status: "review" };
    }
    const assigned = await tx.payment.findUnique({
      where: { providerPaymentId: paymentJobRef },
    });
    const subscriptionCharge = await tx.subscriptionCharge.findUnique({
      where: { paymentReference: paymentJobRef },
    });
    if (subscriptionCharge || (assigned && assigned.id !== payment.id)) {
      return { status: "review" };
    }
    if (payment.status === "SUCCEEDED") {
      return payment.providerPaymentId === paymentJobRef && assigned?.id === payment.id
        ? { status: "confirmed", listingId: payment.listingId, notifications: [] }
        : { status: "review" };
    }
    if (payment.providerPaymentId) return { status: "review" };

    const pendingCount = await tx.payment.count({
      where: {
        status: "PENDING",
        type: paymentType,
        paymentProvider: "RIPPLE",
        listing: { userId: context.userId },
      },
    });
    if (pendingCount !== 1) return { status: "review" };
    if (receipts.length === 0) return { status: "waiting" };
    if (receipts.length !== 1) return { status: "review" };
    const inbox = receipts[0];
    if (inbox.status === "PENDING" || inbox.status === "PROCESSING") {
      return { status: "waiting" };
    }
    const minimized = missingReferenceReceipt({
      inbox,
      paymentJobRef,
      productCode,
      amountPence,
      email: context.email,
      earliest: context.issuedAt - CLOCK_SKEW_MS,
      now,
    });
    if (!minimized) return { status: "review" };

    const event = eventFromMinimizedPayload({
      minimized: { ...minimized, merchant_reference: context.merchantReference },
      customerEmailNorm: inbox.customerEmailNorm,
    });
    if (
      event.metadata.listingId !== context.listingId ||
      event.metadata.checkoutType !== checkoutType ||
      event.paymentStatus !== "SUCCEEDED"
    ) {
      return { status: "review" };
    }

    const claimed = await tx.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "FAILED",
        lastErrorCode: "MISSING_REFERENCE",
        attemptCount: inbox.attemptCount,
      },
      data: { status: "PROCESSING", lastErrorCode: null, attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new ClaimChangedError();

    const reconciled = await reconcileListingPaymentInTransaction(tx, {
      paymentId: payment.id,
      merchantReference: context.merchantReference,
      providerPaymentId: paymentJobRef,
      providerEventAt: inbox.eventTimestamp,
      event,
      evidence: {
        type: "VERIFIED_WEBHOOK",
        evidenceId: inbox.id,
        snapshot: {
          correlation: "signed_hosted_return_and_verified_webhook",
          webhookOmittedMerchantReference: true,
          inboxId: inbox.id,
          paymentReference: paymentJobRef,
          linkCode: productCode,
          amountPence,
          currency: "gbp",
        },
      },
    });

    const completed = await tx.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "PROCESSING",
        attemptCount: inbox.attemptCount + 1,
      },
      data: { status: "PROCESSED", processedAt: new Date(), lastErrorCode: null },
    });
    if (completed.count !== 1) throw new ClaimChangedError();
    return {
      status: "confirmed",
      listingId: payment.listingId,
      notifications: reconciled.notifications ?? [],
    };
  }, { isolationLevel: "Serializable" });
}

async function dispatchReturnNotifications(
  notifications: ListingNotificationIntent[],
  checkoutType: ListingCheckoutType,
) {
  try {
    await dispatchListingNotifications(notifications);
  } catch {
    try {
      await captureBusinessEvent({
        source: "BUSINESS",
        severity: "HIGH",
        title: "Listing notification failed after payment",
        message: "Hosted return reconciliation committed but its notification failed.",
        action: "reconcileHostedReturn",
        route: "/pay/success",
        requestPath: "/pay/success",
        tags: { checkoutType },
      });
    } catch {
      // The payment is already committed.
    }
  }
}
