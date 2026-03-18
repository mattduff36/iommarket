import Stripe from "stripe";
import { getFeaturedFeePence } from "@/lib/config/marketplace";
import { getDealerStripePriceId } from "@/lib/config/dealer-tiers";
import type { DealerTier } from "@prisma/client";

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
  checkoutType?: "listing_payment" | "listing_support";
  lineItemDescription?: string;
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
              description:
                params.lineItemDescription ??
                "30-day marketplace listing on itrader.im",
            },
            unit_amount: params.amountInPence,
          },
          quantity: 1,
        },
      ],
      metadata: {
        listingId: params.listingId,
        type: params.checkoutType ?? "listing_payment",
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
  tier: DealerTier;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = getStripe();
  const priceId = getDealerStripePriceId(params.tier);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: params.customerEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      dealerId: params.dealerId,
      type: "dealer_subscription",
      tier: params.tier,
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

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/**
 * Refund a payment intent (full refund).
 */
export async function refundPaymentIntent(paymentIntentId: string) {
  const stripe = getStripe();
  return stripe.refunds.create({ payment_intent: paymentIntentId });
}

/**
 * Resolve the most recent paid subscription invoice with a payment intent.
 * Used by admin tooling to refund subscription payments.
 */
export async function getLatestPaidSubscriptionPaymentIntent(
  stripeSubscriptionId: string
) {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    subscription: stripeSubscriptionId,
    limit: 20,
    // Newer Stripe API versions expose invoice payments under `payments`
    // instead of `payment_intent` on the invoice root.
    expand: ["data.payments"],
  });

  const latestPaidInvoice = invoices.data.find(
    (invoice) => invoice.status === "paid" && invoice.amount_paid > 0
  );

  if (!latestPaidInvoice) {
    return null;
  }

  // Stripe SDK v20+ removed `payment_intent` from the Invoice type.
  // Access it via the `payments` expansion; fall back to the legacy field
  // (still returned by the API) for older API versions.
  const legacy = (latestPaidInvoice as unknown as Record<string, unknown>)
    .payment_intent;
  const rootPaymentIntentId =
    typeof legacy === "string"
      ? legacy
      : (legacy as { id?: string } | null | undefined)?.id ?? null;

  const invoicePayments = latestPaidInvoice.payments?.data ?? [];
  const rawInvoicePI = invoicePayments.find(
    (entry) =>
      entry.status === "paid" &&
      entry.payment?.type === "payment_intent" &&
      Boolean(entry.payment.payment_intent)
  )?.payment.payment_intent ?? null;
  const invoicePaymentIntentId =
    typeof rawInvoicePI === "string"
      ? rawInvoicePI
      : rawInvoicePI?.id ?? null;

  const paymentIntentId = rootPaymentIntentId ?? invoicePaymentIntentId;

  if (!paymentIntentId) {
    return null;
  }

  return {
    invoiceId: latestPaidInvoice.id,
    paymentIntentId,
    amountPaid: latestPaidInvoice.amount_paid,
    currency: latestPaidInvoice.currency ?? "gbp",
  };
}

/**
 * Cancel a Stripe subscription.
 * @param immediately If true, cancel now. Otherwise cancel at period end.
 */
export async function cancelStripeSubscription(
  stripeSubscriptionId: string,
  immediately: boolean
) {
  const stripe = getStripe();
  if (immediately) {
    return stripe.subscriptions.cancel(stripeSubscriptionId);
  }
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}
