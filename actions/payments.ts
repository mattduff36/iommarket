"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import {
  createListingCheckout,
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
  isDemoDealerSubscriptionCheckoutConfigured,
  isDemoListingCheckoutConfigured,
} from "@/lib/payments/provider";
import {
  createCheckoutSchema,
  createDealerSubscriptionSchema,
  payForListingSchema,
  type PayForListingInput,
} from "@/lib/validations/payment";
import {
  isPrivateListingFreeForUser,
} from "@/lib/config/marketplace";
import {
  getDealerPlanPricePence,
  getMarketplacePricing,
} from "@/lib/config/marketplace-pricing";
import { getDealerEntitlement } from "@/lib/dealers/entitlement";
import { captureException } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider";
import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type HostedReturnContext = "listing" | "featured" | "subscription";

function getDemoPaymentUnavailableError(isDemoCheckoutConfigured: boolean) {
  if (process.env.NODE_ENV === "production") {
    return "Temporary demo payment controls are only available in development.";
  }
  if (isDemoCheckoutConfigured) {
    return null;
  }

  return "Temporary demo payment controls are only available while Ripple demo checkout is active.";
}

function buildHostedReturnUrl(params: {
  status: "success" | "cancel";
  context: HostedReturnContext;
  returnTo: string;
  listingId?: string;
  flow?: "private" | "dealer";
}) {
  const url = new URL("/payment-return", APP_URL);

  url.searchParams.set("status", params.status);
  url.searchParams.set("context", params.context);
  url.searchParams.set("returnTo", params.returnTo);

  if (params.listingId) {
    url.searchParams.set("listing", params.listingId);
  }

  if (params.flow) {
    url.searchParams.set("flow", params.flow);
  }

  return url.toString();
}

function toUserPaymentError(message: string) {
  if (message.includes("RIPPLE_LISTING_PAYMENT_URL")) {
    return "Listing checkout is not configured yet. Please contact support.";
  }
  if (message.includes("RIPPLE_LISTING_SUPPORT_URL")) {
    return "Payments are temporarily unavailable in this environment. Please try again later.";
  }
  if (message.includes("RIPPLE_DEALER_PRO_URL")) {
    return "Dealer Pro checkout is not configured yet. Please contact support.";
  }
  if (message.includes("RIPPLE_DEALER_STARTER_URL")) {
    return "Dealer Starter checkout is not configured yet. Please contact support.";
  }
  if (message.includes("RIPPLE_FEATURED_PAYMENT_URL")) {
    return "Featured upgrade checkout is not configured yet. Please contact support.";
  }
  if (message.includes("RIPPLE_LIVE_CHECKOUT_ENABLED")) {
    return "Card checkout is not enabled yet. Please try again after payments go live.";
  }
  if (message.includes("amount must be")) {
    return "Checkout pricing does not match the Ripple payment link. Please contact support.";
  }
  return message;
}

// ---------------------------------------------------------------------------
// Pay for Listing (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function payForListing(input: PayForListingInput) {
  const user = await requireAcceptedAuth();
  const parsed = payForListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const { listingId, privateSellerTermsAccepted } = parsed.data;
  const checkoutRate = checkRateLimit(
    makeRateLimitKey("checkout-listing", `${user.id}:${listingId}`),
    { windowMs: 5 * 60_000, maxRequests: 5 }
  );
  if (!checkoutRate.allowed) {
    return {
      error: "Too many checkout attempts. Please wait a few minutes and try again.",
    };
  }

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      dealer: { select: { tier: true } },
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status === "LIVE") {
    return { data: { checkoutUrl: null, skippedPayment: true } };
  }
  if (listing.status === "TAKEN_DOWN" || listing.status === "REJECTED") {
    const { canSkipListingPayment } = await import("@/lib/listings/payment-skip");
    const skip = await canSkipListingPayment(db, {
      listingId: listing.id,
      userId: user.id,
      dealerId: listing.dealerId,
    });
    if (skip.skip) {
      return { data: { checkoutUrl: null, skippedPayment: true } };
    }
    return { error: "Payment is required before this listing can be resubmitted." };
  }
  if (listing.status !== "DRAFT" && listing.status !== "EXPIRED") {
    return { error: "This listing cannot be paid for in its current state" };
  }

  try {
    if (!listing.dealerId) {
      const {
        hasCurrentBundleAcceptance,
        recordAcceptance,
      } = await import("@/lib/policy/acceptance");
      if (privateSellerTermsAccepted === true) {
        try {
          await recordAcceptance(db, {
            userId: user.id,
            acceptanceType: "LISTING_BUNDLE",
            source: "LISTING",
          });
        } catch {
          throw new Error(
            "Unable to record Private Seller Terms acceptance. Please try again.",
          );
        }
      } else {
        const { getPolicyFlags } = await import("@/lib/policy/flags");
        if (getPolicyFlags().enforceAcceptance) {
          let previouslyAccepted: boolean;
          try {
            previouslyAccepted = await hasCurrentBundleAcceptance(
              user.id,
              "LISTING_BUNDLE",
            );
          } catch {
            throw new Error(
              "Unable to verify Private Seller Terms acceptance. Please try again.",
            );
          }
          if (!previouslyAccepted) {
            return {
              error:
                "You must accept the Private Seller Terms before opening checkout.",
            };
          }
        }
      }
    }

    const isRenewal = Boolean(
      listing.expiresAt && listing.expiresAt.getTime() <= Date.now(),
    );
    if (!isRenewal && listing.status === "DRAFT" && !listing.dealerId) {
      const { canSkipListingPayment } = await import(
        "@/lib/listings/payment-skip"
      );
      const priorEntitlement = await canSkipListingPayment(db, {
        listingId: listing.id,
        userId: user.id,
        dealerId: listing.dealerId,
      });
      if (priorEntitlement.skip) {
        return { data: { checkoutUrl: null, skippedPayment: true } };
      }
    }

    const pricing = await getMarketplacePricing();
    const flow = listing.dealerId ? "dealer" : "private";
    const listingReturnTo = `/sell/checkout?listing=${listing.id}&flow=${flow}`;
    const dealerEntitlement =
      listing.dealerId && listing.dealer
        ? await getDealerEntitlement(listing.dealerId, listing.dealer.tier)
        : null;
    const hasDealerAccess = Boolean(dealerEntitlement);
    if (listing.dealerId && !hasDealerAccess) {
      return {
        error: "Active dealer access is required before submitting dealer listings.",
      };
    }
    const isFreePrivateSeller =
      !listing.dealerId &&
      (await isPrivateListingFreeForUser(user.id));
    const shouldSkipPayment =
      hasDealerAccess || (!isRenewal && isFreePrivateSeller);
    if (shouldSkipPayment) {
      // Do NOT update status here. The caller must still invoke submitListingForReview
      // so that server-side image validation (≥ 2 photos) is enforced before the
      // listing enters the moderation queue.
      return { data: { checkoutUrl: null, skippedPayment: true } };
    }

    const session = await createListingCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      amountInPence: pricing.privateListingPence,
      checkoutType: "listing_payment",
      customerEmail: user.email,
      successUrl: buildHostedReturnUrl({
        status: "success",
        context: "listing",
        listingId: listing.id,
        flow,
        returnTo: listingReturnTo,
      }),
      cancelUrl: buildHostedReturnUrl({
        status: "cancel",
        context: "listing",
        listingId: listing.id,
        flow,
        returnTo: listingReturnTo,
      }),
      idempotencyKey: `listing-pay-${listing.id}-${Date.now()}`,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "payForListing",
      route: "/sell/checkout",
      requestPath: "/sell/checkout",
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    const message =
      err instanceof Error ? err.message : "Failed to create checkout";
    return { error: toUserPaymentError(message) };
  }
}

// ---------------------------------------------------------------------------
// Create Dealer Subscription (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function createDealerSubscription(input: {
  tier?: "STARTER" | "PRO";
  acceptedDealerTerms: boolean;
}) {
  const user = await requireAcceptedAuth();
  const subscriptionRate = checkRateLimit(
    makeRateLimitKey("checkout-dealer-subscription", user.id),
    { windowMs: 10 * 60_000, maxRequests: 4 }
  );
  if (!subscriptionRate.allowed) {
    return {
      error:
        "Too many subscription checkout attempts. Please wait a few minutes and try again.",
    };
  }

  if (!user.dealerProfile) {
    return { error: "You must have a dealer profile to subscribe" };
  }

  const parsed = createDealerSubscriptionSchema.safeParse({
    dealerId: user.dealerProfile.id,
    tier: input.tier ?? "STARTER",
    acceptedDealerTerms: input.acceptedDealerTerms,
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { recordAcceptance } = await import("@/lib/policy/acceptance");
  await recordAcceptance(db, {
    userId: user.id,
    acceptanceType: "DEALER_BUNDLE",
    source: "SUBSCRIBE",
  });

  try {
    const pricing = await getMarketplacePricing();
    const dashboardReturnTo = "/dealer/dashboard?subscribed=true";
    const pricingReturnTo = "/pricing";
    const session = await createDealerSubscriptionCheckout({
      dealerId: parsed.data.dealerId,
      tier: parsed.data.tier,
      amountInPence: getDealerPlanPricePence(pricing, parsed.data.tier),
      customerEmail: user.email,
      successUrl: buildHostedReturnUrl({
        status: "success",
        context: "subscription",
        returnTo: dashboardReturnTo,
      }),
      cancelUrl: buildHostedReturnUrl({
        status: "cancel",
        context: "subscription",
        returnTo: pricingReturnTo,
      }),
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "createDealerSubscription",
      route: "/dealer/subscribe",
      requestPath: "/dealer/subscribe",
      userId: user.id,
      userEmail: user.email,
      tags: { tier: parsed.data.tier },
    });
    const message =
      err instanceof Error ? err.message : "Failed to create subscription";
    return { error: toUserPaymentError(message) };
  }
}

// ---------------------------------------------------------------------------
// Featured Listing Upgrade (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function upgradeFeatured(listingId: string) {
  const user = await requireAcceptedAuth();
  const featuredRate = checkRateLimit(
    makeRateLimitKey("checkout-featured-upgrade", `${user.id}:${listingId}`),
    { windowMs: 5 * 60_000, maxRequests: 5 }
  );
  if (!featuredRate.allowed) {
    return {
      error: "Too many featured upgrade attempts. Please wait and try again.",
    };
  }

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
    const pricing = await getMarketplacePricing();
    const listingReturnTo = `/listings/${listing.id}`;
    const session = await createFeaturedUpgradeCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      customerEmail: user.email,
      successUrl: buildHostedReturnUrl({
        status: "success",
        context: "featured",
        listingId: listing.id,
        returnTo: `${listingReturnTo}?featured=true`,
      }),
      cancelUrl: buildHostedReturnUrl({
        status: "cancel",
        context: "featured",
        listingId: listing.id,
        returnTo: listingReturnTo,
      }),
      amountInPence: pricing.featuredUpgradePence,
    });

    return { data: { checkoutUrl: session.url } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "upgradeFeatured",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    const message =
      err instanceof Error ? err.message : "Failed to create checkout";
    return { error: toUserPaymentError(message) };
  }
}

// ---------------------------------------------------------------------------
// Temporary demo controls for listing checkout outcomes
// ---------------------------------------------------------------------------

export async function simulateDemoListingPaymentOutcome(input: {
  listingId: string;
  flow: "private" | "dealer";
  outcome: "success" | "declined";
}) {
  const unavailableError = getDemoPaymentUnavailableError(
    isDemoListingCheckoutConfigured()
  );
  if (unavailableError) {
    return { error: unavailableError };
  }
  const user = await requireAcceptedAuth();

  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!listing) {
    return { error: "Listing not found" };
  }

  if (listing.userId !== user.id && user.role !== "ADMIN") {
    return { error: "Not authorized" };
  }

  const providerPaymentId = `demo_listing_payment_${listing.id}`;
  const providerReference = `demo-listing-${listing.id}`;
  const eventType =
    input.outcome === "success" ? "payment.received" : "payment.failed";

  try {
    const pricing = await getMarketplacePricing();
    const simulatedEvent: NormalizedProviderWebhookEvent = {
      id: `demo-webhook-${listing.id}-${input.outcome}`,
      type: eventType,
      rawType: eventType,
      providerPaymentId,
      providerReference,
      providerSubscriptionId: null,
      providerPlanId: null,
      paymentStatus:
        input.outcome === "success" ? "SUCCEEDED" : "DECLINED",
      subscriptionStatus: null,
      amount: pricing.privateListingPence,
      currency: "gbp",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      eventTimestamp: new Date(),
      clientId: null,
      customerEmail: null,
      linkCode: null,
      packageName: null,
      recurring: false,
      linkType: "one-off",
      fingerprint: `demo-webhook-${listing.id}-${input.outcome}`,
      metadata: {
        checkoutType: "listing_payment",
        listingId: listing.id,
        dealerId: null,
        tier: null,
      },
      payload: {
        source: "demo-modal",
        emulatedWebhook: true,
      },
    };

    await processProviderWebhookEvent(simulatedEvent);

    revalidatePath("/");
    revalidatePath("/account/listings");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    revalidatePath(`/listings/${listing.id}`);
    revalidatePath(`/sell/checkout?listing=${listing.id}&flow=${input.flow}`);

    return {
      data: {
        paymentStatus:
          input.outcome === "success" ? "SUCCEEDED" : "FAILED",
        nextUrl:
          input.outcome === "success"
            ? `/sell/success?listing=${listing.id}&flow=${input.flow}&payment=paid`
            : `/sell/checkout?listing=${listing.id}&flow=${input.flow}`,
      },
    };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "simulateDemoListingPaymentOutcome",
      route: "/sell/checkout",
      requestPath: "/sell/checkout",
      userId: user.id,
      userEmail: user.email,
      tags: {
        listingId: listing.id,
        outcome: input.outcome,
      },
    });

    const message =
      err instanceof Error
        ? err.message
        : "Failed to simulate the demo payment outcome";

    return { error: message };
  }
}

export async function simulateDemoDealerSubscriptionOutcome(input: {
  tier: "STARTER" | "PRO";
  outcome: "success" | "declined";
}) {
  const unavailableError = getDemoPaymentUnavailableError(
    isDemoDealerSubscriptionCheckoutConfigured(input.tier)
  );
  if (unavailableError) {
    return { error: unavailableError };
  }
  const user = await requireAcceptedAuth();

  if (!user.dealerProfile) {
    return { error: "You must have a dealer profile before simulating subscription payment." };
  }

  const providerSubscriptionId = `demo_subscription_${user.dealerProfile.id}_${input.tier.toLowerCase()}`;
  const providerPlanId = `demo_plan_${input.tier.toLowerCase()}`;
  const eventType =
    input.outcome === "success" ? "subscription.created" : "subscription.updated";

  try {
    const simulatedEvent: NormalizedProviderWebhookEvent = {
      id: `demo-webhook-subscription-${user.dealerProfile.id}-${input.outcome}`,
      type: eventType,
      rawType: eventType,
      providerPaymentId: null,
      providerReference: null,
      providerSubscriptionId,
      providerPlanId,
      paymentStatus: null,
      subscriptionStatus:
        input.outcome === "success" ? "ACTIVE" : "DECLINED",
      amount: null,
      currency: "gbp",
      currentPeriodEnd:
        input.outcome === "success"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : null,
      cancelAtPeriodEnd: null,
      eventTimestamp: new Date(),
      clientId: null,
      customerEmail: user.email,
      linkCode: null,
      packageName: input.tier === "PRO" ? "Dealer Pro subscription" : "Dealer Starter subscription",
      recurring: true,
      linkType: "recurring",
      fingerprint: `demo-webhook-subscription-${user.dealerProfile.id}-${input.outcome}`,
      metadata: {
        checkoutType: "dealer_subscription",
        listingId: null,
        dealerId: user.dealerProfile.id,
        tier: input.tier,
      },
      payload: {
        source: "demo-modal",
        emulatedWebhook: true,
      },
    };

    await processProviderWebhookEvent(simulatedEvent);

    revalidatePath("/");
    revalidatePath("/pricing");
    revalidatePath("/dealer/subscribe");
    revalidatePath("/dealer/dashboard");
    revalidatePath("/admin/payments");

    return {
      data: {
        subscriptionStatus:
          input.outcome === "success" ? "ACTIVE" : "PAST_DUE",
        nextUrl:
          input.outcome === "success"
            ? "/dealer/dashboard?subscribed=true"
            : `/dealer/subscribe?tier=${input.tier}&payment=declined`,
      },
    };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "simulateDemoDealerSubscriptionOutcome",
      route: "/dealer/subscribe",
      requestPath: "/dealer/subscribe",
      userId: user.id,
      userEmail: user.email,
      tags: {
        dealerId: user.dealerProfile.id,
        tier: input.tier,
        outcome: input.outcome,
      },
    });

    const message =
      err instanceof Error
        ? err.message
        : "Failed to simulate the demo subscription outcome";

    return { error: message };
  }
}
