"use server";

import { revalidatePath } from "next/cache";
import { setHostedReturnContext } from "@/lib/payments/set-hosted-return-context";
import { presentHostedCheckoutUrl } from "@/lib/payments/staging-return-routing";
import { createSampleCheckout } from "@/lib/payments/sample-checkout";
import { isSampleCheckoutEnabled } from "@/lib/payments/sample-checkout-config";
import { isRipplePreviewRuntime, getRippleProductByCheckoutType } from "@/lib/payments/ripple-config";
import { toRippleCheckoutPayer } from "@/lib/payments/ripple-customer-details";
import { db } from "@/lib/db";
import {
  createListingCheckout,
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
  createListingAndFeaturedCheckout,
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
  isMissingListingPaymentUrlError,
  isPrivateListingFreeForUser,
} from "@/lib/config/marketplace";
import {
  getDealerPlanPricePence,
  getMarketplacePricing,
} from "@/lib/config/marketplace-pricing";
import {
  effectiveListingDealerId,
  getDealerEntitlement,
  hasMismatchedDealerListing,
  hasOperationalDealerAccess,
} from "@/lib/dealers/entitlement";
import { detachListingDealerIdIfNeeded } from "@/lib/listings/submit-dealer-access";
import {
  ADMIN_OWNED_LISTING_ERROR,
  isAdminSellerBlocked,
} from "@/lib/listings/seller-access";
import { captureException } from "@/lib/monitoring";
import { captureWithoutMasking } from "@/lib/forms/public-error";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider";
import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";
import { persistPendingListingPayment } from "@/lib/payments/pending-listing-payment";
import { persistCheckoutAttempt } from "@/lib/payments/checkout-attempts";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import {
  CHECKOUT_OUTCOME_UNKNOWN,
  checkoutUnknownResult,
  requireCheckoutActor,
  trustedCheckoutMessage,
} from "@/lib/payments/checkout-public-error";
import { LISTING_UNAVAILABLE } from "@/lib/listings/save-public-error";

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

function bindCheckoutToPersistedReference(
  session: { url: string; merchantReference: string },
  merchantReference: string,
) {
  const url = new URL(session.url);
  url.searchParams.set("reference", merchantReference);
  return { ...session, merchantReference, url: url.toString() };
}

function toUserPaymentError(message: string) {
  return trustedCheckoutMessage(message);
}

async function guardCustomerCheckout<T>(
  context: {
    action: string;
    route: string;
    userId?: string;
    userEmail?: string;
    tags?: Record<string, string>;
  },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const known = trustedCheckoutMessage(error instanceof Error ? error.message : "");
    if (known) {
      if (!isMissingListingPaymentUrlError(error)) {
        await captureWithoutMasking(() => captureException({
          source: "SERVER",
          error,
          action: context.action,
          route: context.route,
          requestPath: context.route,
          userId: context.userId,
          userEmail: context.userEmail,
          tags: context.tags,
        }));
      }
      return { error: known } as T;
    }
    return checkoutUnknownResult(error, context) as Promise<T>;
  }
}

// ---------------------------------------------------------------------------
// Pay for Listing (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function payForListing(input: PayForListingInput) {
  return guardCustomerCheckout(
    { action: "payForListing", route: "/sell/checkout" },
    () => payForListingBody(input),
  );
}

async function payForListingBody(input: PayForListingInput) {
  const actor = await requireCheckoutActor({
    action: "payForListing",
    route: "/sell/checkout",
    fallbackMessage: CHECKOUT_OUTCOME_UNKNOWN,
  });
  if ("body" in actor) return actor.body;
  const user = actor.user;
  const parsed = payForListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const { listingId, privateSellerTermsAccepted, includeFeatured = false } = parsed.data;
  const checkoutRateError = rateLimitActionError(
    await checkRateLimit(
      makeRateLimitKey("checkout-listing", `${user.id}:${listingId}`),
      { windowMs: 5 * 60_000, maxRequests: 5, policy: "checkout-listing" },
    ),
    "Too many checkout attempts. Please wait a few minutes and try again.",
  );
  if (checkoutRateError) return { error: checkoutRateError };

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      dealer: { select: { tier: true } },
    },
  });
  if (!listing || listing.userId !== user.id || hasMismatchedDealerListing(user, listing)) {
    return { error: LISTING_UNAVAILABLE };
  }
  if (isAdminSellerBlocked(user.role)) {
    return { error: ADMIN_OWNED_LISTING_ERROR };
  }
  if (listing.status === "LIVE") {
    return { data: { checkoutUrl: null, skippedPayment: true } };
  }
  const { getListingWriteOffReadiness } = await import(
    "@/lib/listings/listing-ns-policy"
  );
  const writeOffReadiness = await getListingWriteOffReadiness({
    listingId: listing.id,
    listingStatus: listing.status,
  });
  if (!writeOffReadiness.ok) {
    return { error: writeOffReadiness.error };
  }
  const effectiveDealerId = effectiveListingDealerId(user, listing);
  if (
    listing.status === "TAKEN_DOWN" ||
    listing.status === "REJECTED" ||
    listing.status === "DRAFT" ||
    listing.status === "EXPIRED"
  ) {
    try {
      await detachListingDealerIdIfNeeded(db, listing.id, user, listing);
    } catch (err) {
      await captureWithoutMasking(() => captureException({
        source: "SERVER",
        error: err,
        action: "payForListing",
        route: "/sell/checkout",
        requestPath: "/sell/checkout",
        userId: user.id,
        userEmail: user.email,
        tags: { listingId, step: "detach-stale-dealer" },
      }));
      return { error: "Unable to update this listing. Please try again." };
    }
  }
  if (listing.status === "TAKEN_DOWN" || listing.status === "REJECTED") {
    const { canSkipListingPayment } = await import("@/lib/listings/payment-skip");
    const skip = await canSkipListingPayment(db, {
      listingId: listing.id,
      userId: user.id,
      dealerId: effectiveDealerId,
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
    if (!effectiveDealerId) {
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
    let priorListingEntitlementSkip = false;
    if (!isRenewal && listing.status === "DRAFT" && !effectiveDealerId) {
      const { canSkipListingPayment } = await import(
        "@/lib/listings/payment-skip"
      );
      const priorEntitlement = await canSkipListingPayment(db, {
        listingId: listing.id,
        userId: user.id,
        dealerId: effectiveDealerId,
      });
      priorListingEntitlementSkip = priorEntitlement.skip;
      if (priorListingEntitlementSkip && !includeFeatured) {
        return { data: { checkoutUrl: null, skippedPayment: true } };
      }
    }

    const pricing = await getMarketplacePricing();
    const flow = effectiveDealerId ? "dealer" : "private";
    const listingReturnTo = `/sell/checkout?listing=${listing.id}&flow=${flow}`;
    const dealerEntitlement =
      effectiveDealerId && listing.dealer
        ? await getDealerEntitlement(effectiveDealerId, listing.dealer.tier)
        : null;
    const hasDealerAccess =
      Boolean(dealerEntitlement) ||
      (Boolean(effectiveDealerId) && (await hasOperationalDealerAccess(user)));
    if (effectiveDealerId && !hasDealerAccess) {
      return {
        error: "Active dealer access is required before submitting dealer listings.",
      };
    }
    const isFreePrivateSeller =
      !effectiveDealerId &&
      (await isPrivateListingFreeForUser(user.id));
    const shouldSkipPayment =
      hasDealerAccess || priorListingEntitlementSkip || (!isRenewal && isFreePrivateSeller);
    if (shouldSkipPayment && !includeFeatured) {
      // Do NOT update status here. The caller must still invoke submitListingForReview
      // so that server-side image validation (≥ 2 photos) is enforced before the
      // listing enters the moderation queue.
      return { data: { checkoutUrl: null, skippedPayment: true } };
    }

    if (includeFeatured && shouldSkipPayment) {
      const { submitListingForReview } = await import("@/actions/listings");
      const submitted = await submitListingForReview({ listingId: listing.id, privateSellerTermsAccepted });
      if ("error" in submitted) return { error: submitted.error };
      const featured = await upgradeFeatured(listing.id);
      if ("error" in featured) return { error: featured.error };
      if (!featured.data?.checkoutUrl) return { error: "Unable to create the Featured checkout. Please try again." };
      return { data: { ...featured.data, skippedPayment: false, listingSubmitted: true } };
    }

    const combinedPricePence = pricing.privateListingPence + pricing.featuredUpgradePence;
    if (includeFeatured) {
      const product = getRippleProductByCheckoutType("listing_and_featured");
      if (combinedPricePence !== product.amountPence) {
        throw new Error("Combined listing and Featured pricing does not match the Ripple payment link.");
      }
    }

    if (isSampleCheckoutEnabled()) {
      const sample = await createSampleCheckout({ userId: user.id,
        kind: includeFeatured ? "listing_and_featured" : "listing_payment",
        targetId: listing.id, description: includeFeatured ? `Listing and Featured: ${listing.title}` : `Listing fee: ${listing.title}`,
        amountPence: includeFeatured ? combinedPricePence : pricing.privateListingPence, returnUrl: listingReturnTo });
      return { data: { ...sample.data, skippedPayment: false } };
    }
    if (isRipplePreviewRuntime()) {
      return { error: toUserPaymentError("RIPPLE_PREVIEW_CHECKOUT_DISABLED") ?? CHECKOUT_OUTCOME_UNKNOWN };
    }
    const payer = toRippleCheckoutPayer(user);
    const session = includeFeatured ? await createListingAndFeaturedCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      amountInPence: combinedPricePence,
      payer,
      successUrl: buildHostedReturnUrl({ status: "success", context: "listing", listingId: listing.id, flow, returnTo: listingReturnTo }),
      cancelUrl: buildHostedReturnUrl({ status: "cancel", context: "listing", listingId: listing.id, flow, returnTo: listingReturnTo }),
    }) : await createListingCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      amountInPence: pricing.privateListingPence,
      checkoutType: "listing_payment",
      payer,
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

    const pendingPayment = await persistPendingListingPayment({
      listingId: listing.id,
      merchantReference: session.merchantReference,
      amountPence: includeFeatured ? combinedPricePence : pricing.privateListingPence,
      includesFeatured: includeFeatured,
      allowNewAfterSucceeded: isRenewal,
    });
    if (pendingPayment.alreadyPaid) {
      return { data: { checkoutUrl: null, skippedPayment: true } };
    }
    if (!pendingPayment.payment.providerReference) {
      throw new Error("Persisted payment reference is missing");
    }
    const checkoutProduct = getRippleProductByCheckoutType(
      includeFeatured ? "listing_and_featured" : "listing_payment",
    );
    const productCode = checkoutProduct.code;
    const attempt = await persistCheckoutAttempt({
      userId: user.id,
      listingId: listing.id,
      paymentId: pendingPayment.payment.id,
      kind: includeFeatured ? "LISTING_AND_FEATURED" : "LISTING_PAYMENT",
      merchantReference: pendingPayment.payment.providerReference,
      productCode,
      amountPence: includeFeatured
        ? combinedPricePence
        : pricing.privateListingPence,
    });
    const boundSession = bindCheckoutToPersistedReference(
      session,
      attempt.merchantReference,
    );

    const hostedContext = {
      userId: user.id,
      email: user.email.trim().toLowerCase(),
      paymentId: pendingPayment.payment.id,
      listingId: listing.id,
      merchantReference: boundSession.merchantReference,
      issuedAt: Date.now(),
    };
    if (includeFeatured) {
      await setHostedReturnContext({ ...hostedContext, kind: "listing_and_featured", productCode });
    } else {
      await setHostedReturnContext(hostedContext);
    }
    return { data: { checkoutUrl: presentHostedCheckoutUrl(boundSession.url) } };
  } catch (err) {
    const known = toUserPaymentError(err instanceof Error ? err.message : "");
    if (known) {
      if (!isMissingListingPaymentUrlError(err)) {
        await captureWithoutMasking(() => captureException({
          source: "SERVER",
          error: err,
          action: "payForListing",
          route: "/sell/checkout",
          requestPath: "/sell/checkout",
          userId: user.id,
          userEmail: user.email,
          tags: { listingId },
        }));
      }
      return { error: known };
    }
    return checkoutUnknownResult(err, {
      action: "payForListing",
      route: "/sell/checkout",
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
  }
}

// ---------------------------------------------------------------------------
// Create Dealer Subscription (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function createDealerSubscription(input: {
  tier?: "STARTER" | "PRO";
  testPlan?: boolean;
  acceptedDealerTerms: boolean;
}) {
  return guardCustomerCheckout(
    { action: "createDealerSubscription", route: "/dealer/subscribe" },
    () => createDealerSubscriptionBody(input),
  );
}

async function createDealerSubscriptionBody(input: {
  tier?: "STARTER" | "PRO";
  testPlan?: boolean;
  acceptedDealerTerms: boolean;
}) {
  const actor = await requireCheckoutActor({
    action: "createDealerSubscription",
    route: "/dealer/subscribe",
    fallbackMessage: CHECKOUT_OUTCOME_UNKNOWN,
  });
  if ("body" in actor) return actor.body;
  const user = actor.user;
  if (isRipplePreviewRuntime() && !isSampleCheckoutEnabled()) {
    return { error: toUserPaymentError("RIPPLE_PREVIEW_CHECKOUT_DISABLED") ?? CHECKOUT_OUTCOME_UNKNOWN };
  }
  if (input.testPlan === true) {
    return { error: "The weekly test subscription is no longer available for new signups." };
  }
  const subscriptionRateError = rateLimitActionError(
    await checkRateLimit(
      makeRateLimitKey("checkout-dealer-subscription", user.id),
      { windowMs: 10 * 60_000, maxRequests: 4, policy: "checkout-dealer-subscription" },
    ),
    "Too many subscription checkout attempts. Please wait a few minutes and try again.",
  );
  if (subscriptionRateError) return { error: subscriptionRateError };

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
    if (isSampleCheckoutEnabled()) {
      const sample = await createSampleCheckout({ userId: user.id, kind: "dealer_subscription",
        targetId: parsed.data.dealerId, tier: parsed.data.tier,
        description: `Dealer ${parsed.data.tier === "PRO" ? "Pro" : "Starter"} — monthly subscription`,
        amountPence: getDealerPlanPricePence(pricing, parsed.data.tier),
        returnUrl: `/dealer/subscribe?tier=${parsed.data.tier}` });
      return { data: sample.data };
    }
    const session = await createDealerSubscriptionCheckout({
      dealerId: parsed.data.dealerId,
      tier: parsed.data.tier,
      amountInPence: getDealerPlanPricePence(pricing, parsed.data.tier),
      payer: toRippleCheckoutPayer(user),
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

    const product = getRippleProductByCheckoutType(
      "dealer_subscription",
      parsed.data.tier,
    );
    const productCode = product.code;
    const attempt = await persistCheckoutAttempt({
      userId: user.id,
      dealerId: parsed.data.dealerId,
      kind: "DEALER_SUBSCRIPTION",
      merchantReference: session.merchantReference,
      productCode,
      tier: parsed.data.tier,
      amountPence: product.amountPence,
    });
    const boundSession = bindCheckoutToPersistedReference(
      session,
      attempt.merchantReference,
    );
    await setHostedReturnContext({
      kind: "dealer_subscription", userId: user.id, email: user.email.trim().toLowerCase(),
      dealerId: parsed.data.dealerId, productCode,
      merchantReference: boundSession.merchantReference, issuedAt: Date.now(),
    });
    return { data: { checkoutUrl: presentHostedCheckoutUrl(boundSession.url) } };
  } catch (err) {
    const known = toUserPaymentError(err instanceof Error ? err.message : "");
    if (known) {
      await captureWithoutMasking(() => captureException({
        source: "SERVER",
        error: err,
        action: "createDealerSubscription",
        route: "/dealer/subscribe",
        requestPath: "/dealer/subscribe",
        userId: user.id,
        userEmail: user.email,
        tags: { tier: parsed.data.tier },
      }));
      return { error: known };
    }
    return checkoutUnknownResult(err, {
      action: "createDealerSubscription",
      route: "/dealer/subscribe",
      userId: user.id,
      userEmail: user.email,
      tags: { tier: parsed.data.tier },
    });
  }
}

// ---------------------------------------------------------------------------
// Featured Listing Upgrade (creates hosted payment session)
// ---------------------------------------------------------------------------

export async function upgradeFeatured(listingId: string) {
  return guardCustomerCheckout(
    { action: "upgradeFeatured", route: `/listings/${listingId}` },
    () => upgradeFeaturedBody(listingId),
  );
}

async function upgradeFeaturedBody(listingId: string) {
  const actor = await requireCheckoutActor({
    action: "upgradeFeatured",
    route: `/listings/${listingId}`,
    fallbackMessage: CHECKOUT_OUTCOME_UNKNOWN,
  });
  if ("body" in actor) return actor.body;
  const user = actor.user;
  if (isRipplePreviewRuntime() && !isSampleCheckoutEnabled()) {
    return { error: toUserPaymentError("RIPPLE_PREVIEW_CHECKOUT_DISABLED") ?? CHECKOUT_OUTCOME_UNKNOWN };
  }
  const featuredRateError = rateLimitActionError(
    await checkRateLimit(
      makeRateLimitKey("checkout-featured-upgrade", `${user.id}:${listingId}`),
      { windowMs: 5 * 60_000, maxRequests: 5, policy: "checkout-featured-upgrade" },
    ),
    "Too many featured upgrade attempts. Please wait and try again.",
  );
  if (featuredRateError) return { error: featuredRateError };

  const parsed = createCheckoutSchema.safeParse({ listingId });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.userId !== user.id) return { error: LISTING_UNAVAILABLE };
  if (isAdminSellerBlocked(user.role)) {
    return { error: ADMIN_OWNED_LISTING_ERROR };
  }
  if (listing.status !== "LIVE" && listing.status !== "PENDING") {
    return { error: "Only submitted listings can be featured" };
  }
  if (listing.featured) {
    return { error: "This listing is already featured" };
  }
  if (listing.dealerId === null) {
    const { canSkipListingPayment } = await import("@/lib/listings/payment-skip");
    const listingEntitlement = await canSkipListingPayment(db, {
      listingId: listing.id, userId: user.id, dealerId: null,
    });
    if (!listingEntitlement.skip) {
      return {
        error:
          "Free listings cannot be featured. Choose a paid listing plan to unlock featured upgrades.",
      };
    }
  }

  try {
    const pricing = await getMarketplacePricing();
    const consumedEntitlement = await db.payment.findFirst({ where: {
      listingId: listing.id, refundedAt: null, status: "SUCCEEDED", featuredAppliedAt: null,
      OR: [{ type: "FEATURED" }, { type: "LISTING", includesFeatured: true }],
    }, select: { id: true } });
    const pendingBundle = await db.payment.findFirst({ where: {
      listingId: listing.id, refundedAt: null, type: "LISTING", includesFeatured: true, status: "PENDING",
    }, select: { id: true } });
    const incompatiblePendingFeatured = await db.payment.findFirst({ where: {
      listingId: listing.id, refundedAt: null, type: "FEATURED", status: "PENDING",
      amount: { not: pricing.featuredUpgradePence },
    }, select: { id: true } });
    if (consumedEntitlement || pendingBundle || incompatiblePendingFeatured) {
      return { error: "A Featured payment is already pending or has been applied to this listing." };
    }
    const listingReturnTo = `/listings/${listing.id}`;
    if (isSampleCheckoutEnabled()) {
      const sample = await createSampleCheckout({ userId: user.id, kind: "featured_upgrade",
        targetId: listing.id, description: `Featured upgrade: ${listing.title}`,
        amountPence: pricing.featuredUpgradePence, returnUrl: listingReturnTo });
      return { data: sample.data };
    }
    const session = await createFeaturedUpgradeCheckout({
      listingId: listing.id,
      listingTitle: listing.title,
      payer: toRippleCheckoutPayer(user),
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

    const product = getRippleProductByCheckoutType("featured_upgrade");
    const productCode = product.code;
    const pending = await persistPendingListingPayment({
      listingId: listing.id, type: "FEATURED", merchantReference: session.merchantReference,
      amountPence: product.amountPence, allowNewAfterSucceeded: true,
    });
    if (pending.alreadyPaid) return { error: "This featured upgrade has already been paid. Refresh your listing." };
    if (!pending.payment.providerReference) throw new Error("Persisted payment reference is missing");
    const attempt = await persistCheckoutAttempt({
      userId: user.id,
      listingId: listing.id,
      paymentId: pending.payment.id,
      kind: "FEATURED_UPGRADE",
      merchantReference: pending.payment.providerReference,
      productCode,
      amountPence: product.amountPence,
    });
    const boundSession = bindCheckoutToPersistedReference(
      session,
      attempt.merchantReference,
    );
    await setHostedReturnContext({
      kind: "featured_upgrade", userId: user.id, email: user.email.trim().toLowerCase(),
      paymentId: pending.payment.id, listingId: listing.id, productCode,
      merchantReference: boundSession.merchantReference, issuedAt: Date.now(),
    });
    return { data: { checkoutUrl: presentHostedCheckoutUrl(boundSession.url) } };
  } catch (err) {
    const known = toUserPaymentError(err instanceof Error ? err.message : "");
    if (known) {
      await captureWithoutMasking(() => captureException({
        source: "SERVER",
        error: err,
        action: "upgradeFeatured",
        route: `/listings/${listingId}`,
        requestPath: `/listings/${listingId}`,
        userId: user.id,
        userEmail: user.email,
        tags: { listingId },
      }));
      return { error: known };
    }
    return checkoutUnknownResult(err, {
      action: "upgradeFeatured",
      route: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
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
  return guardCustomerCheckout(
    { action: "simulateDemoListingPaymentOutcome", route: "/sell/checkout" },
    () => simulateDemoListingPaymentOutcomeBody(input),
  );
}

async function simulateDemoListingPaymentOutcomeBody(input: {
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
  const actor = await requireCheckoutActor({
    action: "simulateDemoListingPaymentOutcome",
    route: "/sell/checkout",
    fallbackMessage: CHECKOUT_OUTCOME_UNKNOWN,
  });
  if ("body" in actor) return actor.body;
  const user = actor.user;

  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!listing || (listing.userId !== user.id && user.role !== "ADMIN")) {
    return { error: LISTING_UNAVAILABLE };
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
    return checkoutUnknownResult(err, {
      action: "simulateDemoListingPaymentOutcome",
      route: "/sell/checkout",
      userId: user.id,
      userEmail: user.email,
      tags: { listingId: listing.id, outcome: input.outcome },
    });
  }
}

export async function simulateDemoDealerSubscriptionOutcome(input: {
  tier: "STARTER" | "PRO";
  outcome: "success" | "declined";
}) {
  return guardCustomerCheckout(
    { action: "simulateDemoDealerSubscriptionOutcome", route: "/dealer/subscribe" },
    () => simulateDemoDealerSubscriptionOutcomeBody(input),
  );
}

async function simulateDemoDealerSubscriptionOutcomeBody(input: {
  tier: "STARTER" | "PRO";
  outcome: "success" | "declined";
}) {
  const unavailableError = getDemoPaymentUnavailableError(
    isDemoDealerSubscriptionCheckoutConfigured(input.tier)
  );
  if (unavailableError) {
    return { error: unavailableError };
  }
  const actor = await requireCheckoutActor({
    action: "simulateDemoDealerSubscriptionOutcome",
    route: "/dealer/subscribe",
    fallbackMessage: CHECKOUT_OUTCOME_UNKNOWN,
  });
  if ("body" in actor) return actor.body;
  const user = actor.user;

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
    return checkoutUnknownResult(err, {
      action: "simulateDemoDealerSubscriptionOutcome",
      route: "/dealer/subscribe",
      userId: user.id,
      userEmail: user.email,
      tags: {
        dealerId: user.dealerProfile.id,
        tier: input.tier,
        outcome: input.outcome,
      },
    });
  }
}
