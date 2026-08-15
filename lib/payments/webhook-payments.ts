import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import type { ListingNotificationIntent } from "@/lib/listings/notification-intents";
import { liveListingWhere } from "@/lib/listings/expiry";
import { transitionListingStatus } from "@/lib/listings/status-events";
import { captureBusinessEvent } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { assertRippleAmountMatchesProduct } from "@/lib/payments/ripple-config";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import { decideProviderEventApplication } from "@/lib/payments/webhook-ordering";

type PaymentDb = Prisma.TransactionClient | typeof db;

type ListingPaymentWrite = {
  payment: { id: string; listingId: string };
  applied: boolean;
};

async function findPaymentByProviderEvent(
  event: NormalizedProviderWebhookEvent,
  client: PaymentDb = db
) {
  const orConditions = [
    ...(event.providerPaymentId ? [{ providerPaymentId: event.providerPaymentId }] : []),
    ...(event.providerReference ? [{ providerReference: event.providerReference }] : []),
  ];
  if (orConditions.length === 0) return null;
  const matches = await client.payment.findMany({
    where: { OR: orConditions },
  });
  const uniqueIds = new Set(matches.map((payment) => payment.id));
  if (uniqueIds.size > 1) {
    throw new Error("Ambiguous Ripple payment correlation");
  }
  return matches[0] ?? null;
}

export async function submitPaidListingForReview(
  listingId: string,
  event: NormalizedProviderWebhookEvent,
  client: PaymentDb = db
): Promise<ListingNotificationIntent[]> {
  const listing = await client.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      trustDeclarationAccepted: true,
      lifecycleRevision: true,
      userId: true,
    },
  });

  if (!listing) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "HIGH",
      title: "Payment webhook references missing listing",
      message: "Provider payment webhook referenced a listing that no longer exists.",
      action: "submitPaidListingForReview",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: buildRippleSafeTags({
        listingId,
        eventType: event.rawType,
      }),
    });
    return [];
  }

  const imageCount = await client.listingImage.count({ where: { listingId } });
  if (
    (listing.status === "DRAFT" || listing.status === "EXPIRED") &&
    imageCount >= 2 &&
    listing.trustDeclarationAccepted
  ) {
    const notifications: ListingNotificationIntent[] = [];
    let expectedRevision = listing.lifecycleRevision;
    if (listing.status === "EXPIRED") {
      const renewed = await transitionListingStatus(
        {
          listingId,
          action: "RENEW",
          expectedRevision,
          actor: { id: listing.userId, role: "USER" },
          source: "USER",
          notes: "Listing renewed after payment",
        },
        client
      );
      if (renewed?.notification) notifications.push(renewed.notification);
      expectedRevision += 1;
    }
    const submitted = await transitionListingStatus(
      {
        listingId,
        action: "SUBMIT",
        expectedRevision,
        actor: { id: listing.userId, role: "USER" },
        source: "PAYMENT",
        notes: "Listing fee paid - submitted for moderation",
      },
      client
    );
    if (submitted?.notification) notifications.push(submitted.notification);
    return notifications;
  }

  await captureBusinessEvent({
    source: "WEBHOOK",
    severity: "MEDIUM",
    title: "Listing payment captured but moderation transition skipped",
    message:
      "Provider payment succeeded but the listing did not meet moderation submission requirements.",
    action: "submitPaidListingForReview",
    route: "/api/webhooks/payments",
    requestPath: "/api/webhooks/payments",
    tags: buildRippleSafeTags({
      listingId,
      status: listing.status,
      imageCount,
      trustDeclarationAccepted: listing.trustDeclarationAccepted,
    }),
  });
  return [];
}

export async function createOrUpdateListingPayment(
  event: NormalizedProviderWebhookEvent,
  status: "SUCCEEDED" | "FAILED" | "REFUNDED",
  client: PaymentDb = db
): Promise<ListingPaymentWrite | null> {
  const listingId = event.metadata.listingId;
  if (!listingId) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "MEDIUM",
      title: "Payment webhook missing listing reference",
      message: "Provider payment webhook could not be linked to a listing.",
      action: "createOrUpdateListingPayment",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: buildRippleSafeTags({
        eventType: event.rawType,
        checkoutType: event.metadata.checkoutType,
      }),
    });
    return null;
  }

  const incomingAt = event.eventTimestamp ?? new Date();
  const incomingFingerprint = event.fingerprint ?? event.id;
  const existing = await findPaymentByProviderEvent(event, client);
  if (existing) {
    const decision = decideProviderEventApplication({
      existingAt: existing.lastProviderEventAt,
      existingType: existing.lastProviderEventType,
      existingFingerprint: existing.lastProviderEventFingerprint,
      incomingAt,
      incomingType: event.type,
      incomingFingerprint,
    });
    if (decision !== "apply") {
      return { payment: existing, applied: false };
    }
    const payment = await client.payment.update({
      where: { id: existing.id },
      data: {
        paymentProvider: "RIPPLE",
        providerPaymentId: event.providerPaymentId ?? existing.providerPaymentId,
        providerReference: event.providerReference ?? existing.providerReference,
        amount: event.amount ?? existing.amount,
        currency: event.currency ?? existing.currency,
        status,
        lastProviderEventAt: incomingAt,
        lastProviderEventType: event.type,
        lastProviderEventFingerprint: incomingFingerprint,
      },
    });
    return { payment, applied: true };
  }

  const payment = await client.payment.create({
    data: {
      listingId,
      paymentProvider: "RIPPLE",
      providerPaymentId: event.providerPaymentId,
      providerReference: event.providerReference,
      amount: event.amount ?? 0,
      currency: event.currency ?? "gbp",
      type:
        event.metadata.checkoutType === "featured_upgrade"
          ? "FEATURED"
          : event.metadata.checkoutType === "listing_support"
            ? "SUPPORT"
            : "LISTING",
      status,
      idempotencyKey: event.providerReference ?? `provider-webhook-${event.id}`,
      lastProviderEventAt: incomingAt,
      lastProviderEventType: event.type,
      lastProviderEventFingerprint: incomingFingerprint,
    },
  });
  return { payment, applied: true };
}

export async function handleOneOffPaymentReceived(
  event: NormalizedProviderWebhookEvent
) {
  const product = resolveRippleProduct({
    linkCode: event.linkCode,
    packageName: event.packageName,
  });
  if (!product || product.checkoutType === "dealer_subscription") {
    throw new Error("Unknown Ripple product");
  }
  if (!event.metadata.listingId || !event.providerReference) {
    throw new Error("Listing payment missing reference");
  }
  assertRippleAmountMatchesProduct(product, event.amount);

  const notifications = await db.$transaction(async (tx) => {
    const result = await createOrUpdateListingPayment(event, "SUCCEEDED", tx);
    if (!result?.applied) return [];

    if (event.metadata.checkoutType === "featured_upgrade") {
      await tx.listing.updateMany({
        where: {
          id: result.payment.listingId,
          ...liveListingWhere(),
        },
        data: { featured: true },
      });
      return [];
    }

    if (event.metadata.checkoutType === "listing_payment") {
      return submitPaidListingForReview(result.payment.listingId, event, tx);
    }
    return [];
  });
  if (notifications.length > 0) {
    try {
      await dispatchListingNotifications(notifications);
    } catch {
      // Email is best-effort after the payment webhook commit.
    }
  }
}

export async function handleFailedOneOffPayment(
  event: NormalizedProviderWebhookEvent
) {
  if (!event.metadata.listingId) return;
  await createOrUpdateListingPayment(event, "FAILED");
}

export async function handleRefundedPayment(
  event: NormalizedProviderWebhookEvent
) {
  const existing = await findPaymentByProviderEvent(event);
  if (!existing) return null;
  return db.payment.update({
    where: { id: existing.id },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
      refundReason: existing.refundReason ?? null,
    },
  });
}
