"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  createListingCheckout,
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
} from "@/lib/payments/stripe";
import {
  createCheckoutSchema,
  createDealerSubscriptionSchema,
  payForListingSchema,
} from "@/lib/validations/payment";
import {
  getListingFeePence,
  isPrivateListingFreeForUser,
} from "@/lib/config/marketplace";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function isStripeCheckoutConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function toUserPaymentError(message: string) {
  if (message.includes("STRIPE_SECRET_KEY")) {
    return "Payments are temporarily unavailable in this environment. Please try again later.";
  }
  if (message.includes("STRIPE_DEALER_PRO_PRICE_ID")) {
    return "Dealer Pro checkout is not configured yet. Please contact support.";
  }
  if (message.includes("STRIPE_DEALER_STARTER_PRICE_ID") || message.includes("STRIPE_DEALER_PRICE_ID")) {
    return "Dealer Starter checkout is not configured yet. Please contact support.";
  }
  return message;
}

// ---------------------------------------------------------------------------
// Pay for Listing (creates Stripe Checkout Session)
// ---------------------------------------------------------------------------

export async function payForListing(
  listingId: string,
  options?: { supportAmountPence?: number }
) {
  const user = await requireAuth();

  const parsed = payForListingSchema.safeParse({
    listingId,
    supportAmountPence: options?.supportAmountPence ?? 0,
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status !== "DRAFT" && listing.status !== "EXPIRED") {
    return { error: "This listing cannot be paid for in its current state" };
  }

  try {
    const flow = listing.dealerId ? "dealer" : "private";
    const hasActiveDealerSubscription = listing.dealerId
      ? await db.subscription.findFirst({
          where: {
            dealerId: listing.dealerId,
            status: "ACTIVE",
          },
          select: { id: true },
        })
      : null;
    const isDealerWithSub = Boolean(hasActiveDealerSubscription);
    if (listing.dealerId && !isDealerWithSub) {
      return {
        error: "Active dealer subscription required before submitting dealer listings.",
      };
    }
    const isFreePrivateSeller =
      !listing.dealerId &&
      (await isPrivateListingFreeForUser(user.id));
    const supportAmountPence = parsed.data.supportAmountPence;
    const shouldSkipPayment = isDealerWithSub || isFreePrivateSeller;
    if (shouldSkipPayment) {
      if (isFreePrivateSeller && supportAmountPence > 0) {
        // Optional support payments should never block the core listing submission flow.
        if (!isStripeCheckoutConfigured()) {
          return { data: { checkoutUrl: null, skippedPayment: true } };
        }

        const supportSession = await createListingCheckout({
          listingId: listing.id,
          listingTitle: listing.title,
          amountInPence: supportAmountPence,
          checkoutType: "listing_support",
          lineItemDescription: "Optional support contribution for itrader.im",
          customerEmail: user.email,
          successUrl: `${APP_URL}/sell/success?listing=${listing.id}&flow=${flow}&payment=support`,
          cancelUrl: `${APP_URL}/sell/checkout?listing=${listing.id}&flow=${flow}`,
          idempotencyKey: `listing-support-${listing.id}-${Date.now()}`,
        });
        return { data: { checkoutUrl: supportSession.url, skippedPayment: true } };
      }

      // Do NOT update status here. The caller must still invoke submitListingForReview
      // so that server-side image validation (≥ 2 photos) is enforced before the
      // listing enters the moderation queue.
      return { data: { checkoutUrl: null, skippedPayment: true } };
    }

    const listingFeePence = getListingFeePence();

    const session = await createListingCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      amountInPence: listingFeePence,
      checkoutType: "listing_payment",
      customerEmail: user.email,
      successUrl: `${APP_URL}/sell/success?listing=${listing.id}&flow=${flow}&payment=paid`,
      cancelUrl: `${APP_URL}/sell/checkout?listing=${listing.id}&flow=${flow}`,
      idempotencyKey: `listing-pay-${listing.id}-${Date.now()}`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout";
    return { error: toUserPaymentError(message) };
  }
}

// ---------------------------------------------------------------------------
// Create Dealer Subscription (creates Stripe Checkout Session)
// ---------------------------------------------------------------------------

export async function createDealerSubscription(tier: "STARTER" | "PRO" = "STARTER") {
  const user = await requireAuth();

  if (!user.dealerProfile) {
    return { error: "You must have a dealer profile to subscribe" };
  }

  const parsed = createDealerSubscriptionSchema.safeParse({
    dealerId: user.dealerProfile.id,
    tier,
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const session = await createDealerSubscriptionCheckout({
      dealerId: parsed.data.dealerId,
      tier: parsed.data.tier,
      customerEmail: user.email,
      successUrl: `${APP_URL}/dealer/dashboard?subscribed=true`,
      cancelUrl: `${APP_URL}/pricing`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create subscription";
    return { error: toUserPaymentError(message) };
  }
}

// ---------------------------------------------------------------------------
// Featured Listing Upgrade (creates Stripe Checkout Session)
// ---------------------------------------------------------------------------

export async function upgradeFeatured(listingId: string) {
  const user = await requireAuth();

  const parsed = createCheckoutSchema.safeParse({ listingId });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status !== "LIVE") {
    return { error: "Only live listings can be featured" };
  }
  if (listing.featured) {
    return { error: "This listing is already featured" };
  }
  if (listing.dealerId === null) {
    const paidListing = await db.payment.findFirst({
      where: {
        listingId: listing.id,
        status: "SUCCEEDED",
        type: "LISTING",
      },
      select: { id: true },
    });
    if (!paidListing) {
      return {
        error:
          "Free listings cannot be featured. Choose a paid listing plan to unlock featured upgrades.",
      };
    }
  }

  try {
    const session = await createFeaturedUpgradeCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      customerEmail: user.email,
      successUrl: `${APP_URL}/listings/${listing.id}?featured=true`,
      cancelUrl: `${APP_URL}/listings/${listing.id}`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout";
    return { error: toUserPaymentError(message) };
  }
}
