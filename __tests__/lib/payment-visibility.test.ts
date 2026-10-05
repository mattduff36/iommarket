import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentActivityFacts, CheckoutReviewFacts } from "@/lib/payments/payment-visibility";
import {
  checkoutNeedsManualReview,
  evidencedWebhookMerchantReferences,
  hostedRipplePendingHasProviderActivity,
  isUnobservedHostedRippleCheckout,
  isVisibleAdminPayment,
  manualReviewCheckoutAttemptWhere,
  resolveManualReviewAttemptWhere,
  resolveVisibleAdminPaymentWhere,
  unobservedHostedRipplePaymentWhere,
  visibleAdminPaymentWhere,
} from "@/lib/payments/payment-visibility";
import { isRecognisedListingRevenue } from "@/lib/payments/records";

function openedFeaturedCheckout(
  overrides: Partial<PaymentActivityFacts> = {},
): PaymentActivityFacts {
  return {
    paymentProvider: "RIPPLE",
    status: "PENDING",
    providerPaymentId: null,
    lastProviderEventAt: null,
    hasProviderClaim: false,
    observationCount: 0,
    reconciliationCount: 0,
    attemptClaimCount: 0,
    hasWebhookForMerchantReference: false,
    ...overrides,
  };
}

function reviewFacts(
  overrides: Partial<CheckoutReviewFacts> = {},
): CheckoutReviewFacts {
  return {
    status: "OPEN",
    observationCount: 0,
    reconciliationCount: 0,
    attemptClaimCount: 0,
    paymentProviderPaymentId: null,
    paymentLastProviderEventAt: null,
    paymentHasProviderClaim: false,
    hasWebhookForMerchantReference: false,
    ...overrides,
  };
}

describe("hosted Ripple checkout visibility", () => {
  it("keeps an opened Featured checkout as an attempt, not a payment", () => {
    const opened = openedFeaturedCheckout();

    expect(hostedRipplePendingHasProviderActivity(opened)).toBe(false);
    expect(isUnobservedHostedRippleCheckout(opened)).toBe(true);
    expect(isVisibleAdminPayment(opened)).toBe(false);
    expect(isRecognisedListingRevenue({ status: opened.status, refundedAt: null })).toBe(false);
    expect(opened.hasProviderClaim).toBe(false);
    expect(checkoutNeedsManualReview(reviewFacts())).toBe(false);
    expect(JSON.stringify(visibleAdminPaymentWhere({}))).not.toMatch(/email/i);
  });

  it("keeps an abandoned checkout hidden after it is marked REVIEW", () => {
    const abandoned = openedFeaturedCheckout();

    expect(isVisibleAdminPayment(abandoned)).toBe(false);
    expect(isRecognisedListingRevenue({ status: "PENDING", refundedAt: null })).toBe(false);
    expect(checkoutNeedsManualReview(reviewFacts({ status: "REVIEW" }))).toBe(false);
    expect(checkoutNeedsManualReview(reviewFacts({ status: "EXPIRED" }))).toBe(false);
    expect(manualReviewCheckoutAttemptWhere()).toMatchObject({
      status: { in: ["OPEN", "RETURNED", "REVIEW"] },
    });
    expect(manualReviewCheckoutAttemptWhere().OR).not.toEqual(
      expect.arrayContaining([{ status: "OPEN" }]),
    );
  });

  it("shows a hosted return as pending without recognising revenue or a claim", () => {
    const observed = openedFeaturedCheckout({ observationCount: 1 });

    expect(hostedRipplePendingHasProviderActivity(observed)).toBe(true);
    expect(isVisibleAdminPayment(observed)).toBe(true);
    expect(isRecognisedListingRevenue({ status: "PENDING", refundedAt: null })).toBe(false);
    expect(observed.hasProviderClaim).toBe(false);
    expect(checkoutNeedsManualReview(reviewFacts({
      status: "RETURNED",
      observationCount: 1,
    }))).toBe(true);
  });

  it("shows a verified webhook payment and recognises its revenue", () => {
    const verified = openedFeaturedCheckout({
      status: "SUCCEEDED",
      providerPaymentId: "261000000000000001",
      lastProviderEventAt: new Date("2026-10-05T12:00:00.000Z"),
      hasProviderClaim: true,
      reconciliationCount: 1,
      attemptClaimCount: 1,
      hasWebhookForMerchantReference: true,
    });

    expect(isVisibleAdminPayment(verified)).toBe(true);
    expect(isRecognisedListingRevenue({ status: verified.status, refundedAt: null })).toBe(true);
    expect(checkoutNeedsManualReview(reviewFacts({ status: "CONFIRMED" }))).toBe(false);
  });

  it("keeps an attested succeeded payment visible without a webhook inbox row", () => {
    const hedy = openedFeaturedCheckout({
      status: "SUCCEEDED",
      providerPaymentId: "261021000420123404",
      hasProviderClaim: true,
      reconciliationCount: 1,
      attemptClaimCount: 1,
      hasWebhookForMerchantReference: false,
    });

    expect(isVisibleAdminPayment(hedy)).toBe(true);
    expect(isUnobservedHostedRippleCheckout(hedy)).toBe(false);
    expect(isRecognisedListingRevenue({ status: "SUCCEEDED", refundedAt: null })).toBe(true);
    expect(unobservedHostedRipplePaymentWhere()).toMatchObject({ status: "PENDING" });
  });

  it("does not treat OPEN or REVIEW status, or email, as provider activity", () => {
    expect(hostedRipplePendingHasProviderActivity(openedFeaturedCheckout())).toBe(false);
    expect(isVisibleAdminPayment(openedFeaturedCheckout({
      paymentProvider: "DEV",
      status: "PENDING",
    }))).toBe(true);
    expect(isVisibleAdminPayment(openedFeaturedCheckout({
      paymentProvider: "STRIPE",
      status: "PENDING",
    }))).toBe(true);
  });

  it("treats a merchant-reference webhook as provider activity", () => {
    const inboxOnly = openedFeaturedCheckout({ hasWebhookForMerchantReference: true });

    expect(isVisibleAdminPayment(inboxOnly)).toBe(true);
    expect(isRecognisedListingRevenue({ status: "PENDING", refundedAt: null })).toBe(false);
    expect(checkoutNeedsManualReview(reviewFacts({
      hasWebhookForMerchantReference: true,
    }))).toBe(true);
    expect(manualReviewCheckoutAttemptWhere(["signed-merchant"])).toMatchObject({
      OR: expect.arrayContaining([
        { merchantReference: { in: ["signed-merchant"] } },
      ]),
    });
  });

  it("excludes unobserved placeholder rows from the admin payment query", () => {
    expect(visibleAdminPaymentWhere({ type: "FEATURED" }, ["signed-merchant"])).toEqual({
      AND: [
        { type: "FEATURED" },
        { NOT: unobservedHostedRipplePaymentWhere(["signed-merchant"]) },
      ],
    });
    expect(unobservedHostedRipplePaymentWhere(["signed-merchant"])).toMatchObject({
      AND: [
        expect.objectContaining({
          paymentProvider: "RIPPLE",
          status: "PENDING",
          providerPaymentId: null,
          providerClaim: { is: null },
        }),
        {
          OR: [
            { providerReference: null },
            { providerReference: { notIn: ["signed-merchant"] } },
          ],
        },
      ],
    });
  });
});

describe("admin payment query resolution", () => {
  const paymentFindMany = vi.fn();
  const inboxFindMany = vi.fn();
  const attemptFindMany = vi.fn();
  const client = {
    payment: { findMany: paymentFindMany },
    paymentWebhookInbox: { findMany: inboxFindMany },
    paymentCheckoutAttempt: { findMany: attemptFindMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a pending row visible when its merchant reference has webhook evidence", async () => {
    paymentFindMany.mockResolvedValue([{ providerReference: "signed-merchant" }]);
    inboxFindMany.mockResolvedValue([{ merchantReference: "signed-merchant" }]);

    await expect(resolveVisibleAdminPaymentWhere({ type: "FEATURED" }, client)).resolves.toEqual(
      visibleAdminPaymentWhere({ type: "FEATURED" }, ["signed-merchant"]),
    );
    expect(inboxFindMany).toHaveBeenCalledWith({
      where: { merchantReference: { in: ["signed-merchant"] } },
      select: { merchantReference: true },
      distinct: ["merchantReference"],
    });
  });

  it("does not query the inbox when no placeholder reference exists", async () => {
    paymentFindMany.mockResolvedValue([]);

    await expect(resolveVisibleAdminPaymentWhere({}, client)).resolves.toEqual(
      visibleAdminPaymentWhere({}, []),
    );
    expect(inboxFindMany).not.toHaveBeenCalled();
  });

  it("asks reconciliation only for attempts with provider evidence", async () => {
    attemptFindMany.mockResolvedValue([
      { merchantReference: "opened-only" },
      { merchantReference: "webhook-ref" },
    ]);
    inboxFindMany.mockResolvedValue([{ merchantReference: "webhook-ref" }]);

    await expect(resolveManualReviewAttemptWhere(client)).resolves.toEqual(
      manualReviewCheckoutAttemptWhere(["webhook-ref"]),
    );
  });

  it("matches webhook evidence only by merchant reference", async () => {
    inboxFindMany.mockResolvedValue([{ merchantReference: "signed-merchant" }]);

    await expect(evidencedWebhookMerchantReferences(
      ["signed-merchant", "signed-merchant", ""],
      client,
    )).resolves.toEqual(["signed-merchant"]);
    expect(JSON.stringify(inboxFindMany.mock.calls[0][0])).not.toMatch(/email/i);
  });
});
