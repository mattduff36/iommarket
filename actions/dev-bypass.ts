"use server";

/**
 * Dev-only server actions that simulate payment-provider webhook effects.
 * These actions are guarded against production use.
 * Remove this file before going live (or leave it — it no-ops in production).
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

function assertDevMode() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Dev bypass actions are not available in production.");
  }
}

// ---------------------------------------------------------------------------
// Activate dealer subscription without hosted checkout
// ---------------------------------------------------------------------------

export async function devActivateDealerSubscription() {
  assertDevMode();

  const user = await requireAuth();
  if (!user.dealerProfile) {
    return { error: "You do not have a dealer profile." };
  }

  const dealerId = user.dealerProfile.id;
  const fakeSubId = `dev_sub_${dealerId}`;

  try {
    await db.subscription.upsert({
      where: { providerSubscriptionId: fakeSubId },
      update: {
        paymentProvider: "DEV",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        dealerId,
        paymentProvider: "DEV",
        providerSubscriptionId: fakeSubId,
        providerPlanId: "dev_plan",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath("/dealer/dashboard");
    return { data: { success: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to activate subscription";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Mark listing as featured without hosted checkout
// ---------------------------------------------------------------------------

export async function devMarkListingFeatured(listingId: string) {
  assertDevMode();

  const user = await requireAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found." };
  if (listing.userId !== user.id && user.role !== "ADMIN") {
    return { error: "Not authorised." };
  }

  try {
    const fakePaymentId = `dev_pi_featured_${listingId}`;

    await db.payment.upsert({
      where: { providerPaymentId: fakePaymentId },
      update: { paymentProvider: "DEV", status: "SUCCEEDED" },
      create: {
        listingId,
        paymentProvider: "DEV",
        providerPaymentId: fakePaymentId,
        providerReference: `dev-featured-${listingId}`,
        amount: 0,
        currency: "gbp",
        status: "SUCCEEDED",
        idempotencyKey: `dev-featured-${listingId}`,
      },
    });

    await db.listing.update({
      where: { id: listingId },
      data: { featured: true },
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: { success: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to mark as featured";
    return { error: message };
  }
}
