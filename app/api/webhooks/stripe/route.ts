import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { constructWebhookEvent } from "@/lib/payments/stripe";
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
        status: "SUCCEEDED",
        idempotencyKey: `checkout-${session.id}`,
      },
    });

    await db.listing.update({
      where: { id: listingId },
      data: { status: "PENDING" },
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

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;

    // Upsert by Stripe subscription ID for idempotency
    await db.subscription.upsert({
      where: { stripeSubscriptionId: subscriptionId },
      update: { status: "ACTIVE" },
      create: {
        dealerId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: process.env.STRIPE_DEALER_PRICE_ID ?? "",
        status: "ACTIVE",
      },
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
      ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
    },
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
