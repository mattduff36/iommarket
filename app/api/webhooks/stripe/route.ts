import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { constructWebhookEvent } from "@/lib/payments/stripe";
import { getDealerTierFromPriceId } from "@/lib/config/dealer-tiers";
import { transitionListingStatus } from "@/lib/listings/status-events";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid webhook";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const type = session.metadata?.type;

  if (type === "listing_payment") {
    const listingId = session.metadata?.listingId;
    if (!listingId || !session.payment_intent) return;

    const stripePaymentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    // Idempotency: skip if payment already recorded
    const existingPayment = await db.payment.findUnique({
      where: { stripePaymentId },
    });
    if (existingPayment) return;

    await db.payment.create({
      data: {
        listingId,
        stripePaymentId,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? "gbp",
        type: "LISTING",
        status: "SUCCEEDED",
        idempotencyKey: `checkout-${session.id}`,
      },
    });

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        status: true,
        trustDeclarationAccepted: true,
      },
    });
    if (!listing) return;

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
        notes: "Listing fee paid — submitted for moderation",
      });
    }
  }

  if (type === "listing_support") {
    const listingId = session.metadata?.listingId;
    if (!listingId || !session.payment_intent) return;

    const stripePaymentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    const existingSupportPayment = await db.payment.findUnique({
      where: { stripePaymentId },
    });
    if (existingSupportPayment) return;

    await db.payment.create({
      data: {
        listingId,
        stripePaymentId,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? "gbp",
        type: "SUPPORT",
        status: "SUCCEEDED",
        idempotencyKey: `support-${session.id}`,
      },
    });
  }

  if (type === "featured_upgrade") {
    const listingId = session.metadata?.listingId;
    if (!listingId || !session.payment_intent) return;

    const stripePaymentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    // Idempotency: skip if payment already recorded
    const existingFeatured = await db.payment.findUnique({
      where: { stripePaymentId },
    });
    if (existingFeatured) return;

    await db.payment.create({
      data: {
        listingId,
        stripePaymentId,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? "gbp",
        type: "FEATURED",
        status: "SUCCEEDED",
        idempotencyKey: `featured-${session.id}`,
      },
    });

    await db.listing.update({
      where: { id: listingId },
      data: { featured: true },
    });
  }

  if (type === "dealer_subscription") {
    const dealerId = session.metadata?.dealerId;
    if (!dealerId || !session.subscription) return;
    const tierFromMetadata =
      session.metadata?.tier === "PRO" ? "PRO" : "STARTER";

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    const stripePriceId =
      tierFromMetadata === "PRO"
        ? process.env.STRIPE_DEALER_PRO_PRICE_ID ?? ""
        : process.env.STRIPE_DEALER_STARTER_PRICE_ID ??
          process.env.STRIPE_DEALER_PRICE_ID ??
          "";
    if (!stripePriceId) return;

    // Upsert by Stripe subscription ID for idempotency
    await db.subscription.upsert({
      where: { stripeSubscriptionId: subscriptionId },
      update: { status: "ACTIVE" },
      create: {
        dealerId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId,
        status: "ACTIVE",
      },
    });
    await db.dealerProfile.update({
      where: { id: dealerId },
      data: { tier: tierFromMetadata },
    });
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const statusMap: Record<string, "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE"> =
    {
      active: "ACTIVE",
      past_due: "PAST_DUE",
      canceled: "CANCELLED",
      incomplete: "INCOMPLETE",
    };

  const status = statusMap[subscription.status] ?? "INCOMPLETE";
  const stripePriceId = subscription.items.data[0]?.price?.id;
  const tier = getDealerTierFromPriceId(stripePriceId);

  // Stripe SDK types vary by version; access period end safely
  const periodEnd = (subscription as unknown as Record<string, unknown>)
    .current_period_end as number | undefined;

  // Idempotency: upsert handles missing records gracefully
  const existing = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  if (!existing) return; // Subscription not in our DB — skip

  await db.subscription.update({
    where: { stripeSubscriptionId: subscription.id },
    data: {
      status,
      ...(stripePriceId ? { stripePriceId } : {}),
      ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
    },
  });
  await db.dealerProfile.update({
    where: { id: existing.dealerId },
    data: { tier },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const existing = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  if (!existing) return;

  await db.subscription.update({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: "CANCELLED" },
  });
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) return;

  await db.payment.updateMany({
    where: { stripePaymentId: paymentIntentId },
    data: { status: "REFUNDED" },
  });
}
