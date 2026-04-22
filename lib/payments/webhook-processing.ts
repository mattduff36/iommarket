import { db } from "@/lib/db";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider";
import { getDealerTierFromProviderPlanId } from "@/lib/config/dealer-tiers";
import { transitionListingStatus } from "@/lib/listings/status-events";
import { captureBusinessEvent } from "@/lib/monitoring";

function mapSubscriptionStatus(
  status: string | null
): "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE" {
  switch (status) {
    case "ACTIVE":
    case "PAID":
    case "COMPLETED":
      return "ACTIVE";
    case "PAST_DUE":
    case "FAILED":
    case "DECLINED":
      return "PAST_DUE";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "INCOMPLETE";
  }
}

async function findPaymentByProviderEvent(event: NormalizedProviderWebhookEvent) {
  const orConditions = [
    ...(event.providerPaymentId
      ? [{ providerPaymentId: event.providerPaymentId }]
      : []),
    ...(event.providerReference
      ? [{ providerReference: event.providerReference }]
      : []),
  ];

  if (orConditions.length === 0) {
    return null;
  }

  return db.payment.findFirst({
    where: {
      OR: orConditions,
    },
  });
}

async function createOrUpdatePayment(
  event: NormalizedProviderWebhookEvent,
  status: "SUCCEEDED" | "FAILED" | "REFUNDED"
) {
  const listingId = event.metadata.listingId;
  if (!listingId) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "MEDIUM",
      title: "Payment webhook missing listing reference",
      message: "Provider payment webhook could not be linked to a listing.",
      action: "createOrUpdatePayment",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: {
        eventId: event.id,
        providerPaymentId: event.providerPaymentId,
        providerReference: event.providerReference,
        checkoutType: event.metadata.checkoutType,
      },
    });
    return null;
  }

  const existing = await findPaymentByProviderEvent(event);
  if (existing) {
    return db.payment.update({
      where: { id: existing.id },
      data: {
        paymentProvider: "RIPPLE",
        providerPaymentId: event.providerPaymentId ?? existing.providerPaymentId,
        providerReference: event.providerReference ?? existing.providerReference,
        amount: event.amount ?? existing.amount,
        currency: event.currency ?? existing.currency,
        status,
      },
    });
  }

  return db.payment.create({
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
    },
  });
}

async function submitPaidListingForReview(
  listingId: string,
  event: NormalizedProviderWebhookEvent
) {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      trustDeclarationAccepted: true,
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
      tags: {
        listingId,
        eventId: event.id,
        providerPaymentId: event.providerPaymentId,
      },
    });
    return;
  }

  const imageCount = await db.listingImage.count({
    where: { listingId },
  });

  if (
    (listing.status === "DRAFT" || listing.status === "EXPIRED") &&
    imageCount >= 2 &&
    listing.trustDeclarationAccepted
  ) {
    await transitionListingStatus({
      listingId,
      toStatus: "PENDING",
      changedByUserId: null,
      source: "PAYMENT",
      notes: "Listing fee paid via Ripple - submitted for moderation",
    });
    return;
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
    tags: {
      listingId,
      status: listing.status,
      imageCount,
      trustDeclarationAccepted: listing.trustDeclarationAccepted,
      eventId: event.id,
    },
  });
}

async function handleSuccessfulPayment(event: NormalizedProviderWebhookEvent) {
  const payment = await createOrUpdatePayment(event, "SUCCEEDED");
  if (!payment) return;

  if (event.metadata.checkoutType === "featured_upgrade" && payment.listingId) {
    await db.listing.update({
      where: { id: payment.listingId },
      data: { featured: true },
    });
    return;
  }

  if (event.metadata.checkoutType === "listing_payment" && payment.listingId) {
    await submitPaidListingForReview(payment.listingId, event);
  }
}

async function handleFailedPayment(event: NormalizedProviderWebhookEvent) {
  await createOrUpdatePayment(event, "FAILED");
}

async function handleRefundedPayment(event: NormalizedProviderWebhookEvent) {
  const existing = await findPaymentByProviderEvent(event);
  if (!existing) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "MEDIUM",
      title: "Refund webhook with no matching payment",
      message: "Provider refund webhook did not match a local payment record.",
      action: "handleRefundedPayment",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: {
        eventId: event.id,
        providerPaymentId: event.providerPaymentId,
        providerReference: event.providerReference,
      },
    });
    return;
  }

  await db.payment.update({
    where: { id: existing.id },
    data: { status: "REFUNDED" },
  });
}

async function upsertDealerSubscription(event: NormalizedProviderWebhookEvent) {
  const providerSubscriptionId = event.providerSubscriptionId;
  if (!providerSubscriptionId) {
    return;
  }

  const existing = await db.subscription.findFirst({
    where: { providerSubscriptionId },
  });
  const dealerId = event.metadata.dealerId ?? existing?.dealerId ?? null;
  if (!dealerId) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "HIGH",
      title: "Subscription webhook missing dealer reference",
      message: "Provider subscription webhook could not be linked to a dealer profile.",
      action: "upsertDealerSubscription",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: {
        eventId: event.id,
        providerSubscriptionId,
      },
    });
    return;
  }

  const tier =
    event.metadata.tier ??
    getDealerTierFromProviderPlanId(event.providerPlanId) ??
    "STARTER";
  const status = mapSubscriptionStatus(event.subscriptionStatus);

  const subscription = existing
    ? await db.subscription.update({
        where: { id: existing.id },
        data: {
          paymentProvider: "RIPPLE",
          providerSubscriptionId,
          providerPlanId: event.providerPlanId ?? existing.providerPlanId,
          status,
          ...(event.currentPeriodEnd
            ? { currentPeriodEnd: event.currentPeriodEnd }
            : {}),
        },
      })
    : await db.subscription.create({
        data: {
          dealerId,
          paymentProvider: "RIPPLE",
          providerSubscriptionId,
          providerPlanId: event.providerPlanId,
          status,
          currentPeriodEnd: event.currentPeriodEnd,
        },
      });

  await db.dealerProfile.update({
    where: { id: subscription.dealerId },
    data: { tier },
  });

  const dealerProfile = await db.dealerProfile.findUnique({
    where: { id: subscription.dealerId },
    select: { userId: true },
  });

  if (dealerProfile) {
    await db.user.update({
      where: { id: dealerProfile.userId },
      data: { role: "DEALER" },
    });
  }
}

async function cancelDealerSubscription(event: NormalizedProviderWebhookEvent) {
  if (!event.providerSubscriptionId) return;

  const existing = await db.subscription.findFirst({
    where: { providerSubscriptionId: event.providerSubscriptionId },
  });

  if (!existing) {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "LOW",
      title: "Subscription deletion with no local record",
      message:
        "Provider subscription cancellation webhook was received for an unknown subscription.",
      action: "cancelDealerSubscription",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: {
        eventId: event.id,
        providerSubscriptionId: event.providerSubscriptionId,
      },
    });
    return;
  }

  await db.subscription.update({
    where: { id: existing.id },
    data: { status: "CANCELLED" },
  });
}

export async function processProviderWebhookEvent(
  event: NormalizedProviderWebhookEvent
) {
  switch (event.type) {
    case "payment.succeeded":
      await handleSuccessfulPayment(event);
      break;
    case "payment.failed":
      await handleFailedPayment(event);
      break;
    case "payment.refunded":
      await handleRefundedPayment(event);
      break;
    case "subscription.created":
    case "subscription.updated":
      await upsertDealerSubscription(event);
      break;
    case "subscription.cancelled":
      await cancelDealerSubscription(event);
      break;
    default:
      break;
  }
}
