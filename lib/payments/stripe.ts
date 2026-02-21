import Stripe from "stripe";
import { getFeaturedFeePence } from "@/lib/config/marketplace";

let _stripe: Stripe | null = null;

/**
 * Lazy-initialised Stripe client. Avoids throwing at module evaluation
 * during build when env vars are not yet available.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(key, {
      apiVersion: "2026-01-28.clover",
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Create a checkout session for a single listing payment.
 */
export async function createListingCheckout(params: {
  listingId: string;
  listingTitle: string;
  amountInPence: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  idempotencyKey?: string;
}) {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: params.customerEmail,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Listing: ${params.listingTitle}`,
              description: "30-day marketplace listing on itrader.im",
            },
            unit_amount: params.amountInPence,
          },
          quantity: 1,
        },
      ],
      metadata: {
        listingId: params.listingId,
        type: "listing_payment",
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    params.idempotencyKey
      ? { idempotencyKey: params.idempotencyKey }
      : undefined
  );

  return session;
}

/**
 * Create a subscription checkout session for a dealer.
 */
export async function createDealerSubscriptionCheckout(params: {
  dealerId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_DEALER_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_DEALER_PRICE_ID is not set");

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: params.customerEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      dealerId: params.dealerId,
      type: "dealer_subscription",
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  return session;
}

/**
 * Create a checkout session for a featured listing upgrade.
 */
export async function createFeaturedUpgradeCheckout(params: {
  listingId: string;
  listingTitle: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}) {
  const stripe = getStripe();
  const featuredPriceId = process.env.STRIPE_FEATURED_PRICE_ID;
  const featuredFeePence = getFeaturedFeePence();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: params.customerEmail,
    line_items: [
      featuredPriceId
        ? { price: featuredPriceId, quantity: 1 }
        : {
            price_data: {
              currency: "gbp",
              product_data: {
                name: `Featured Upgrade: ${params.listingTitle}`,
                description: "Promote your listing to featured status on itrader.im",
              },
              unit_amount: featuredFeePence,
            },
            quantity: 1,
          },
    ],
    metadata: {
      listingId: params.listingId,
      type: "featured_upgrade",
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  return session;
}

/**
 * Construct and verify a Stripe webhook event.
 */
export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  return stripe.webhooks.constructEvent(body, signature, secret);
}
