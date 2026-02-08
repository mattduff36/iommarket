"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  createListingCheckout,
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
} from "@/lib/payments/stripe";
import { createCheckoutSchema } from "@/lib/validations/payment";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Pay for Listing (creates Stripe Checkout Session)
// ---------------------------------------------------------------------------

export async function payForListing(listingId: string) {
  const user = await requireAuth();

  const parsed = createCheckoutSchema.safeParse({ listingId });
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
    // Default listing fee: £4.99 = 499 pence
    const LISTING_FEE_PENCE = 499;

    const session = await createListingCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      amountInPence: LISTING_FEE_PENCE,
      customerEmail: user.email,
      successUrl: `${APP_URL}/sell/success?listing=${listing.id}`,
      cancelUrl: `${APP_URL}/sell/checkout?listing=${listing.id}`,
      idempotencyKey: `listing-pay-${listing.id}-${Date.now()}`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Create Dealer Subscription (creates Stripe Checkout Session)
// ---------------------------------------------------------------------------

export async function createDealerSubscription() {
  const user = await requireAuth();

  if (!user.dealerProfile) {
    return { error: "You must have a dealer profile to subscribe" };
  }

  try {
    const session = await createDealerSubscriptionCheckout({
      dealerId: user.dealerProfile.id,
      customerEmail: user.email,
      successUrl: `${APP_URL}/dealer/dashboard?subscribed=true`,
      cancelUrl: `${APP_URL}/pricing`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create subscription";
    return { error: message };
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
    return { error: message };
  }
}
