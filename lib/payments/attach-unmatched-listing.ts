import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  eventFromMinimizedPayload,
  type RippleMinimizedPayload,
} from "@/lib/payments/ripple-contract";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import { handleOneOffPaymentReceived } from "@/lib/payments/webhook-payments";

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
}) {
  const inbox = await db.paymentWebhookInbox.findUnique({
    where: { id: input.inboxId },
  });
  if (!inbox) {
    throw new AttachUnmatchedListingError("Inbox row not found");
  }
  if (inbox.status === "PROCESSED" || inbox.status === "QUARANTINED") {
    throw new AttachUnmatchedListingError("Inbox row is already processed");
  }

  const product = resolveRippleProduct({
    linkCode: inbox.linkCode,
    packageName: inbox.packageName,
  });
  if (!product || product.checkoutType === "dealer_subscription") {
    throw new AttachUnmatchedListingError("Inbox row is not a listing fee");
  }
  if (product.checkoutType !== "listing_payment") {
    throw new AttachUnmatchedListingError("Inbox row is not a listing fee");
  }
  if (product.code !== RIPPLE_CANONICAL_PRODUCTS.listing.code) {
    throw new AttachUnmatchedListingError("Inbox row is not a listing fee");
  }
  if (inbox.amountPence !== product.amountPence) {
    throw new AttachUnmatchedListingError("Inbox amount does not match listing fee");
  }

  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    select: { id: true },
  });
  if (!listing) {
    throw new AttachUnmatchedListingError("Listing not found");
  }

  const existingPayment = await db.payment.findFirst({
    where: {
      listingId: listing.id,
      type: "LISTING",
      status: "SUCCEEDED",
    },
    select: { id: true },
  });
  if (existingPayment) {
    throw new AttachUnmatchedListingError(
      "Listing already has a succeeded listing fee",
    );
  }

  const minimized = asMinimizedPayload(inbox.minimizedPayload);
  if (!minimized) {
    throw new AttachUnmatchedListingError("Inbox payload is not replayable");
  }

  const merchantReference = createRippleReference({
    purpose: "listing_payment",
    targetId: listing.id,
    linkCode: product.code,
  });

  const event = eventFromMinimizedPayload({
    minimized: {
      ...minimized,
      client_id: minimized.client_id || inbox.clientId,
      merchant_reference: merchantReference,
    },
    customerEmailNorm: inbox.customerEmailNorm,
  });

  if (
    event.metadata.listingId !== listing.id ||
    event.metadata.checkoutType !== "listing_payment" ||
    !event.providerReference
  ) {
    throw new AttachUnmatchedListingError("Bound listing reference is invalid");
  }

  const claimed = await db.paymentWebhookInbox.updateMany({
    where: {
      id: inbox.id,
      status: { in: ["PENDING", "FAILED"] },
      attemptCount: inbox.attemptCount,
    },
    data: {
      status: "PROCESSING",
      lastErrorCode: null,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    throw new AttachUnmatchedListingError("Inbox row is already being processed");
  }
  const claimedAttempt = inbox.attemptCount + 1;

  try {
    await handleOneOffPaymentReceived(event);
  } catch (error) {
    await db.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "PROCESSING",
        attemptCount: claimedAttempt,
      },
      data: {
        status: "FAILED",
        lastErrorCode: "ATTACH_FAILED",
      },
    });
    throw error;
  }

  const processed = await db.paymentWebhookInbox.updateMany({
    where: {
      id: inbox.id,
      status: "PROCESSING",
      attemptCount: claimedAttempt,
    },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: null,
      merchantReference,
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
    merchantReference,
    amountPence: product.amountPence,
  };
}
