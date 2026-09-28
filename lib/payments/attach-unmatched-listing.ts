import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import { captureBusinessEvent } from "@/lib/monitoring";
import {
  eventFromMinimizedPayload,
  type RippleMinimizedPayload,
} from "@/lib/payments/ripple-contract";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { parseRippleReference } from "@/lib/payments/ripple-reference";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import {
  createOrUpdateListingPayment,
  submitPaidListingForReview,
} from "@/lib/payments/webhook-payments";

function asMinimizedPayload(value: unknown): RippleMinimizedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RippleMinimizedPayload;
}

export class AttachUnmatchedListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachUnmatchedListingError";
  }
}

export async function attachUnmatchedListingPayment(input: {
  inboxId: string;
  listingId: string;
  confirmedCurrentlyPaidAndNotRefunded: boolean;
}) {
  if (input.confirmedCurrentlyPaidAndNotRefunded !== true) {
    throw new AttachUnmatchedListingError(
      "Confirm in Ripple that this payment is currently paid and not refunded",
    );
  }

  const result = await db.$transaction(async (tx) => {
    const inbox = await tx.paymentWebhookInbox.findUnique({
      where: { id: input.inboxId },
    });
    if (!inbox) {
      throw new AttachUnmatchedListingError("Inbox row not found");
    }

    const minimized = asMinimizedPayload(inbox.minimizedPayload);
    if (!minimized) {
      throw new AttachUnmatchedListingError("Inbox payload is not replayable");
    }
    if (
      (inbox.status !== "FAILED" && inbox.status !== "PROCESSED") ||
      (inbox.status === "FAILED" &&
        !["MISSING_REFERENCE", "INVALID_REFERENCE"].includes(
          inbox.lastErrorCode ?? "",
        ))
    ) {
      throw new AttachUnmatchedListingError(
        "Inbox row is not an eligible failed listing receipt",
      );
    }
    if (
      inbox.eventType !== "payment.received" ||
      minimized.event !== "payment.received"
    ) {
      throw new AttachUnmatchedListingError(
        "Only a successful payment.received event can be attached",
      );
    }
    if (
      !inbox.paymentReference ||
      minimized.payment_reference !== inbox.paymentReference
    ) {
      throw new AttachUnmatchedListingError(
        "Inbox row has no matching Ripple payment reference",
      );
    }
    if (
      minimized.recurring === true ||
      minimized.link_type?.toLowerCase() === "recurring"
    ) {
      throw new AttachUnmatchedListingError(
        "Recurring payment events cannot be attached to listing fees",
      );
    }

    const product = resolveRippleProduct({
      linkCode: inbox.linkCode,
      packageName: inbox.packageName,
    });
    if (
      !product ||
      product.checkoutType !== "listing_payment" ||
      product.code !== RIPPLE_CANONICAL_PRODUCTS.listing.code
    ) {
      throw new AttachUnmatchedListingError("Inbox row is not a listing fee");
    }
    if (
      inbox.amountPence !== product.amountPence ||
      inbox.currency?.toLowerCase() !== "gbp" ||
      minimized.amount !== product.amountPence / 100 ||
      minimized.currency?.toLowerCase() !== "gbp"
    ) {
      throw new AttachUnmatchedListingError(
        "Inbox amount or currency does not match listing fee",
      );
    }

    const inboundReference = minimized.merchant_reference?.trim() || null;
    if (inboundReference) {
      try {
        const claims = parseRippleReference(inboundReference, product.code);
        if (claims) {
          throw new AttachUnmatchedListingError(
            "Inbox already contains a valid reference",
          );
        }
      } catch (error) {
        if (error instanceof AttachUnmatchedListingError) throw error;
        // An invalid/missing provider reference is the recovery condition.
      }
    }

    const listing = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true },
    });
    if (!listing) {
      throw new AttachUnmatchedListingError("Listing not found");
    }

    const duplicate = await tx.payment.findUnique({
      where: { providerPaymentId: inbox.paymentReference },
      select: {
        id: true,
        listingId: true,
        paymentProvider: true,
        type: true,
        status: true,
        providerReference: true,
        amount: true,
        currency: true,
      },
    });
    if (duplicate) {
      let duplicateClaims = null;
      try {
        duplicateClaims = parseRippleReference(
          duplicate.providerReference,
          product.code,
        );
      } catch {
        // A previously attached payment is idempotent only with valid signed claims.
      }
      if (
        duplicate.listingId !== listing.id ||
        duplicate.paymentProvider !== "RIPPLE" ||
        duplicate.type !== "LISTING" ||
        duplicate.status !== "SUCCEEDED" ||
        duplicate.amount !== product.amountPence ||
        duplicate.currency.toLowerCase() !== "gbp" ||
        duplicateClaims?.purpose !== "listing_payment" ||
        duplicateClaims.targetId !== listing.id
      ) {
        throw new AttachUnmatchedListingError(
          "Ripple payment reference is already assigned to another payment",
        );
      }

      if (inbox.status === "PROCESSED") {
        return {
          inboxId: inbox.id,
          listingId: listing.id,
          merchantReference: duplicate.providerReference,
          providerPaymentId: inbox.paymentReference,
          amountPence: product.amountPence,
          notifications: [],
        };
      }

      const processed = await tx.paymentWebhookInbox.updateMany({
        where: {
          id: inbox.id,
          status: "FAILED",
          lastErrorCode: { in: ["MISSING_REFERENCE", "INVALID_REFERENCE"] },
          attemptCount: inbox.attemptCount,
        },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          lastErrorCode: null,
        },
      });
      if (processed.count !== 1) {
        throw new AttachUnmatchedListingError(
          "Inbox claim changed before attach completed",
        );
      }
      return {
        inboxId: inbox.id,
        listingId: listing.id,
        merchantReference: duplicate.providerReference,
        providerPaymentId: inbox.paymentReference,
        amountPence: product.amountPence,
        notifications: [],
      };
    }

    if (inbox.status !== "FAILED") {
      throw new AttachUnmatchedListingError("Inbox row is already processed");
    }

    const payment = await tx.payment.findFirst({
      where: {
        listingId: listing.id,
        type: "LISTING",
        paymentProvider: "RIPPLE",
        status: "PENDING",
        providerPaymentId: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) {
      throw new AttachUnmatchedListingError(
        "No pending Ripple listing payment exists for this listing",
      );
    }
    if (
      payment.listingId !== listing.id ||
      payment.type !== "LISTING" ||
      payment.paymentProvider !== "RIPPLE" ||
      payment.status !== "PENDING" ||
      payment.providerPaymentId !== null
    ) {
      throw new AttachUnmatchedListingError(
        "Pending payment is not an eligible Ripple listing fee",
      );
    }
    if (
      payment.amount !== product.amountPence ||
      payment.currency.toLowerCase() !== "gbp"
    ) {
      throw new AttachUnmatchedListingError(
        "Pending payment amount or currency does not match listing fee",
      );
    }

    let claims;
    try {
      claims = parseRippleReference(payment.providerReference, product.code);
    } catch {
      throw new AttachUnmatchedListingError(
        "Pending payment reference is invalid",
      );
    }
    if (
      !claims ||
      claims.purpose !== "listing_payment" ||
      claims.targetId !== listing.id
    ) {
      throw new AttachUnmatchedListingError(
        "Pending payment reference does not match this listing",
      );
    }

    const event = eventFromMinimizedPayload({
      minimized: {
        ...minimized,
        merchant_reference: payment.providerReference,
      },
      customerEmailNorm: inbox.customerEmailNorm,
    });
    if (
      event.type !== "payment.received" ||
      event.paymentStatus !== "SUCCEEDED" ||
      event.recurring === true ||
      event.linkType?.toLowerCase() === "recurring" ||
      event.metadata.listingId !== listing.id ||
      event.metadata.checkoutType !== "listing_payment" ||
      event.providerPaymentId !== inbox.paymentReference ||
      event.providerReference !== payment.providerReference ||
      event.amount !== product.amountPence ||
      event.currency?.toLowerCase() !== "gbp"
    ) {
      throw new AttachUnmatchedListingError(
        "Verified receipt does not match the pending listing payment",
      );
    }

    const claimed = await tx.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "FAILED",
        lastErrorCode: { in: ["MISSING_REFERENCE", "INVALID_REFERENCE"] },
        attemptCount: inbox.attemptCount,
      },
      data: {
        status: "PROCESSING",
        lastErrorCode: null,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new AttachUnmatchedListingError(
        "Inbox row is already being processed",
      );
    }
    const claimedAttempt = inbox.attemptCount + 1;

    const reservedPayment = await tx.payment.updateMany({
      where: {
        id: payment.id,
        listingId: listing.id,
        type: "LISTING",
        paymentProvider: "RIPPLE",
        status: "PENDING",
        providerPaymentId: null,
        providerReference: payment.providerReference,
      },
      data: { providerPaymentId: event.providerPaymentId },
    });
    if (reservedPayment.count !== 1) {
      throw new AttachUnmatchedListingError(
        "Pending payment was already claimed or changed",
      );
    }

    const paymentResult = await createOrUpdateListingPayment(
      event,
      "SUCCEEDED",
      tx,
    );
    if (!paymentResult?.applied) {
      throw new AttachUnmatchedListingError(
        "Pending payment could not be safely applied",
      );
    }
    const notifications = await submitPaidListingForReview(
      listing.id,
      event,
      tx,
    );
    const processed = await tx.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "PROCESSING",
        attemptCount: claimedAttempt,
      },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastErrorCode: null,
      } satisfies Prisma.PaymentWebhookInboxUpdateInput,
    });
    if (processed.count !== 1) {
      throw new AttachUnmatchedListingError(
        "Inbox claim changed before attach completed",
      );
    }

    return {
      inboxId: inbox.id,
      listingId: listing.id,
      merchantReference: payment.providerReference,
      providerPaymentId: inbox.paymentReference,
      amountPence: product.amountPence,
      notifications,
    };
  }, { isolationLevel: "Serializable" });

  if (result.notifications.length > 0) {
    try {
      await dispatchListingNotifications(result.notifications);
    } catch (error) {
      await captureBusinessEvent({
        source: "BUSINESS",
        severity: "HIGH",
        title: "Listing notification failed after payment",
        message:
          "The payment was committed, but the listing notification email failed.",
        action: "attachUnmatchedListingPayment",
        route: "/admin/payments",
        requestPath: "/admin/payments",
        tags: { checkoutType: "listing_payment" },
        extra: { errorName: error instanceof Error ? error.name : "unknown" },
      });
    }
  }

  return {
    inboxId: result.inboxId,
    listingId: result.listingId,
    merchantReference: result.merchantReference,
    providerPaymentId: result.providerPaymentId,
    amountPence: result.amountPence,
  };
}
