import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeHostedReturnContext } from "@/lib/payments/hosted-return-context";

const originalSupportUrl = process.env.RIPPLE_LISTING_SUPPORT_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalEnforceAcceptance = process.env.POLICY_ENFORCE_ACCEPTANCE;
const mutableEnvironment = process.env as Record<string, string | undefined>;

const {
  requireAuthMock,
  isPrivateListingFreeForUserMock,
  createListingCheckoutMock,
  createListingAndFeaturedCheckoutMock,
  createFeaturedUpgradeCheckoutMock,
  submitListingForReviewMock,
  createDealerSubscriptionCheckoutMock,
  processProviderWebhookEventMock,
  captureExceptionMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  getMarketplacePricingMock,
  getDealerPlanPricePenceMock,
  isDemoListingCheckoutConfiguredMock,
  isDemoDealerSubscriptionCheckoutConfiguredMock,
  revalidatePathMock,
  setCookieMock,
  persistCheckoutAttemptMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isPrivateListingFreeForUserMock: vi.fn(),
  createListingCheckoutMock: vi.fn(),
  createListingAndFeaturedCheckoutMock: vi.fn(),
  createFeaturedUpgradeCheckoutMock: vi.fn(),
  submitListingForReviewMock: vi.fn(),
  createDealerSubscriptionCheckoutMock: vi.fn(),
  processProviderWebhookEventMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  getMarketplacePricingMock: vi.fn(),
  getDealerPlanPricePenceMock: vi.fn(),
  isDemoListingCheckoutConfiguredMock: vi.fn(),
  isDemoDealerSubscriptionCheckoutConfiguredMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setCookieMock: vi.fn(),
  persistCheckoutAttemptMock: vi.fn(),
  mockDb: {
    listing: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    listingAttributeValue: {
      findFirst: vi.fn(),
    },
    listingRevisionAttributeValue: {
      findFirst: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    freeListingClaim: {
      findUnique: vi.fn(),
    },
    policyAcceptance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAuthMock,
}));

vi.mock("@/lib/config/marketplace", () => ({
  isPrivateListingFreeForUser: isPrivateListingFreeForUserMock,
  isMissingListingPaymentUrlError: (error: unknown) =>
    error instanceof Error && error.message.includes("RIPPLE_LISTING_PAYMENT_URL"),
}));

vi.mock("@/lib/config/marketplace-pricing", () => ({
  getMarketplacePricing: getMarketplacePricingMock,
  getDealerPlanPricePence: getDealerPlanPricePenceMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookieMock }) }));

vi.mock("@/lib/payments/webhook-processing", () => ({
  processProviderWebhookEvent: processProviderWebhookEventMock,
}));
vi.mock("@/lib/payments/checkout-attempts", () => ({
  persistCheckoutAttempt: persistCheckoutAttemptMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: makeRateLimitKeyMock,
}));

vi.mock("@/lib/payments/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/provider")>(
    "@/lib/payments/provider"
  );

  return {
    ...actual,
    createListingCheckout: createListingCheckoutMock,
    createListingAndFeaturedCheckout: createListingAndFeaturedCheckoutMock,
    createFeaturedUpgradeCheckout: createFeaturedUpgradeCheckoutMock,
    createDealerSubscriptionCheckout: createDealerSubscriptionCheckoutMock,
    isDemoListingCheckoutConfigured: isDemoListingCheckoutConfiguredMock,
    isDemoDealerSubscriptionCheckoutConfigured:
      isDemoDealerSubscriptionCheckoutConfiguredMock,
  };
});

vi.mock("@/actions/listings", () => ({ submitListingForReview: submitListingForReviewMock }));

import {
  createDealerSubscription,
  payForListing,
  simulateDemoDealerSubscriptionOutcome,
  simulateDemoListingPaymentOutcome,
  upgradeFeatured,
} from "@/actions/payments";

describe("payForListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.subscription.findMany.mockResolvedValue([]);
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", "test-checkout-context-secret-at-least-32-characters");

    delete process.env.RIPPLE_LISTING_SUPPORT_URL;
    delete process.env.POLICY_ENFORCE_ACCEPTANCE;

    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
    });
    persistCheckoutAttemptMock.mockImplementation((input) =>
      Promise.resolve({
        id: "attempt-1",
        status: "OPEN",
        ...input,
      }),
    );
    checkRateLimitMock.mockReturnValue({ allowed: true });
    makeRateLimitKeyMock.mockReturnValue("checkout-listing:user_123");
    isPrivateListingFreeForUserMock.mockResolvedValue(true);
    getMarketplacePricingMock.mockResolvedValue({
      privateListingPence: 749,
      featuredUpgradePence: 875,
      dealerStarterMonthlyPence: 3999,
      dealerProMonthlyPence: 5999,
      optionalListingSupportPence: 500,
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      title: "Test listing",
      category: {
        slug: "car",
        attributeDefinitions: [
          {
            id: "write-off",
            slug: "write-off-category",
            name: "Insurance write-off category",
            dataType: "select",
            required: false,
            options: JSON.stringify(["None", "Category N", "Category S"]),
          },
        ],
      },
    });
    mockDb.listingAttributeValue.findFirst.mockResolvedValue(null);
    mockDb.listingRevisionAttributeValue.findFirst.mockResolvedValue(null);
    mockDb.policyAcceptance.findUnique.mockResolvedValue(null);
    mockDb.policyAcceptance.upsert.mockResolvedValue({ id: "acceptance-1" });
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);
    mockDb.payment.create.mockResolvedValue({
      id: "pending-pay",
      status: "PENDING",
    });
    mockDb.payment.create.mockImplementation(async ({ data }) => ({
      id: "pending-pay",
      status: "PENDING",
      ...data,
    }));
    mockDb.payment.update.mockResolvedValue({
      id: "pending-pay",
      status: "PENDING",
    });
    mockDb.listing.update.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      dealerId: null,
    });
    submitListingForReviewMock.mockResolvedValue({ data: { status: "PENDING" } });
    createFeaturedUpgradeCheckoutMock.mockResolvedValue({
      provider: "RIPPLE",
      merchantReference: "featured-reference-new",
      url: "https://portal.startyourripple.co.uk/card/client/pay/1BB714D5DBC446B6?reference=featured-reference-new",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalSupportUrl === undefined) {
      delete process.env.RIPPLE_LISTING_SUPPORT_URL;
    } else {
      process.env.RIPPLE_LISTING_SUPPORT_URL = originalSupportUrl;
    }

    if (originalNodeEnv === undefined) {
      delete mutableEnvironment.NODE_ENV;
    } else {
      mutableEnvironment.NODE_ENV = originalNodeEnv;
    }

    if (originalEnforceAcceptance === undefined) {
      delete process.env.POLICY_ENFORCE_ACCEPTANCE;
    } else {
      process.env.POLICY_ENFORCE_ACCEPTANCE = originalEnforceAcceptance;
    }
  });

  it("never opens a new support checkout POL-PAY-001", async () => {
    const result = await payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result).toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });
    expect(isPrivateListingFreeForUserMock).toHaveBeenCalledWith("user_123");
    expect(mockDb.policyAcceptance.findUnique).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("uses canonical combined pricing and binds the URL to the persisted merchant reference", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    getMarketplacePricingMock.mockResolvedValue({
      privateListingPence: 499, featuredUpgradePence: 500,
      dealerStarterMonthlyPence: 3999, dealerProMonthlyPence: 5999, optionalListingSupportPence: 500,
    });
    createListingAndFeaturedCheckoutMock.mockResolvedValue({
      provider: "RIPPLE", merchantReference: "new-reference",
      url: "https://portal.startyourripple.co.uk/card/client/pay/9AFE8E93CD3145D3?reference=new-reference",
    });

    const result = await payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa", privateSellerTermsAccepted: true, includeFeatured: true,
    });

    expect(createListingAndFeaturedCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      amountInPence: 999,
      payer: { dealerName: null, accountName: null, email: "seller@example.com" },
    }));
    expect(mockDb.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 999, includesFeatured: true, providerReference: "new-reference" }),
    }));
    expect(result).toEqual({ data: { checkoutUrl: expect.stringContaining("reference=new-reference") } });
  });

  it("submits an already-claimed free listing before opening the standalone Featured checkout", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    getMarketplacePricingMock.mockResolvedValue({
      privateListingPence: 499, featuredUpgradePence: 500,
      dealerStarterMonthlyPence: 3999, dealerProMonthlyPence: 5999, optionalListingSupportPence: 500,
    });
    mockDb.freeListingClaim.findUnique.mockResolvedValue({ id: "claim-1", userId: "user_123" });
    let status = "DRAFT";
    mockDb.listing.findUnique.mockImplementation(async () => ({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa", userId: "user_123", dealerId: null,
      status, title: "Test listing", category: { slug: "car", attributeDefinitions: [] },
    }));
    submitListingForReviewMock.mockImplementation(async () => {
      status = "PENDING";
      return { data: { status } };
    });

    const result = await payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa", privateSellerTermsAccepted: true, includeFeatured: true,
    });

    expect(submitListingForReviewMock).toHaveBeenCalledWith(expect.objectContaining({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }));
    expect(createListingAndFeaturedCheckoutMock).not.toHaveBeenCalled();
    expect(createFeaturedUpgradeCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ amountInPence: 500 }));
    expect(result).toEqual({ data: { checkoutUrl: expect.any(String), skippedPayment: false, listingSubmitted: true } });
  });

  it.each([true, false])("preserves free listing submission but blocks new preview charges (free=%s)", async (free) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    isPrivateListingFreeForUserMock.mockResolvedValue(free);
    const result = await payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(result).toEqual(free
      ? { data: { checkoutUrl: null, skippedPayment: true } }
      : { error: "New payments are disabled on preview. Existing subscriptions continue to renew." });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(mockDb.payment.create).not.toHaveBeenCalled();
  });

  it("never opens checkout for a live listing revision ALR-PAY-001", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "LIVE",
      title: "Live listing",
    });

    await expect(payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
    })).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });

  it("skips checkout when a taken-down listing was already paid ALR-RESUB-001", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "TAKEN_DOWN",
      title: "Taken down listing",
    });
    mockDb.subscription.findFirst.mockResolvedValue(null);
    mockDb.payment.findFirst.mockResolvedValue({ id: "pay-1" });
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);

    await expect(payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
    })).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });

  it("does not open a second checkout for a paid draft MD-SELL-004", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.payment.findFirst.mockResolvedValue({ id: "pay-1" });

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });

    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledOnce();
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });

  it("RIP-PEND-002 does not return a new checkout if payment wins the open race", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "paid-during-checkout", status: "SUCCEEDED" });
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);
    createListingCheckoutMock.mockResolvedValue({
      url: "https://checkout.example.com/listing-race",
      merchantReference:
        "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:race:mac",
      provider: "RIPPLE",
    });

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });

    expect(createListingCheckoutMock).toHaveBeenCalledOnce();
    expect(mockDb.payment.create).not.toHaveBeenCalled();
  });

  it("does not charge after a paid pending submission is withdrawn and resubmitted", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      title: "Withdrawn paid listing",
      lifecycleRevision: 3,
    });
    mockDb.payment.findFirst.mockResolvedValue({ id: "original-payment" });
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });

    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(isPrivateListingFreeForUserMock).not.toHaveBeenCalled();
  });

  it("does not charge a withdrawn draft with its original free claim MD-LIFE-003", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.freeListingClaim.findUnique.mockResolvedValue({
      id: "claim-1",
      userId: "user_123",
    });

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });

    expect(isPrivateListingFreeForUserMock).not.toHaveBeenCalled();
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });

  it("requires checkout to renew an expired free listing", async () => {
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      name: "Ada Lovelace",
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      expiresAt: new Date("2025-01-01T00:00:00Z"),
      title: "Test listing",
    });
    createListingCheckoutMock.mockResolvedValue({
      url: "https://checkout.example.com/listing-renewal",
      merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n1:mac",
      provider: "RIPPLE",
    });

    await expect(payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      privateSellerTermsAccepted: true,
    })).resolves.toEqual({
      data: {
      checkoutUrl: expect.stringContaining("https://checkout.example.com/listing-renewal?reference="),
      },
    });

    expect(createListingCheckoutMock).toHaveBeenCalledOnce();
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledOnce();
    expect(setCookieMock).toHaveBeenCalledWith("itrader-listing-checkout", expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 1800 }));
    expect(decodeHostedReturnContext(setCookieMock.mock.calls[0][1])).toEqual(expect.objectContaining({
      userId: "user_123", paymentId: "pending-pay", listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      email: "seller@example.com", merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n1:mac",
    }));
    expect(
      mockDb.policyAcceptance.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(createListingCheckoutMock.mock.invocationCallOrder[0]);
    expect(createListingCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInPence: 749,
        payer: { dealerName: null, accountName: "Ada Lovelace", email: "seller@example.com" },
      }),
    );
    expect(mockDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        status: "PENDING",
        providerReference:
          "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n1:mac",
        type: "LISTING",
      }),
    });
  });

  it("returns the support message without capturing a missing listing payment URL", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      expiresAt: new Date("2025-01-01T00:00:00Z"),
      title: "Test listing",
    });
    createListingCheckoutMock.mockRejectedValue(
      new Error("RIPPLE_LISTING_PAYMENT_URL is not set"),
    );

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error: "Listing checkout is not configured yet. Please contact support.",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns a safe action error when an enforced receipt lookup fails", async () => {
    process.env.POLICY_ENFORCE_ACCEPTANCE = "true";
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.policyAcceptance.findUnique.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      error:
        "Unable to verify Private Seller Terms acceptance. Please try again.",
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("does not create checkout when the explicit receipt cannot be recorded", async () => {
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.policyAcceptance.upsert.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "Unable to record Private Seller Terms acceptance. Please try again.",
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("treats a demoted seller with an active subscription as private at checkout", async () => {
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: "dealer-1",
      status: "TAKEN_DOWN",
      title: "Taken down listing",
      dealer: { tier: "STARTER" },
    });
    mockDb.subscription.findMany.mockResolvedValue([
      {
        id: "sub-paid",
        source: "PAYMENT",
        providerPlanId: "8181FAC1359E413E",
        currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]);
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      error: "Payment is required before this listing can be resubmitted.",
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(mockDb.listing.update).toHaveBeenCalledWith({
      where: { id: "caaaaaaaaaaaaaaaaaaaaaaaa" },
      data: { dealerId: null },
    });
  });

  it("requires private terms and private checkout after dealer demotion", async () => {
    process.env.POLICY_ENFORCE_ACCEPTANCE = "true";
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "user_123",
      dealerId: "dealer-1",
      status: "DRAFT",
      title: "Demoted listing",
      dealer: { tier: "STARTER" },
    });
    mockDb.subscription.findMany.mockResolvedValue([
      {
        id: "sub-paid",
        source: "PAYMENT",
        providerPlanId: "8181FAC1359E413E",
        currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]);
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      error:
        "You must accept the Private Seller Terms before opening checkout.",
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();

    createListingCheckoutMock.mockResolvedValue({
      url: "https://checkout.example.com/listing-private",
      merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n2:mac",
      provider: "RIPPLE",
    });
    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { checkoutUrl: expect.stringContaining("https://checkout.example.com/listing-private?reference=") },
    });
    expect(createListingCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: expect.stringContaining("flow=private"),
        cancelUrl: expect.stringContaining("flow=private"),
      }),
    );
    expect(mockDb.listing.update).toHaveBeenCalledWith({
      where: { id: "caaaaaaaaaaaaaaaaaaaaaaaa" },
      data: { dealerId: null },
    });
  });

  it("AUD-PAY-POL-001 blocks hosted checkout when write-off is not ready", async () => {
    const previous = process.env.POLICY_ENFORCE_LISTING_NS;
    process.env.POLICY_ENFORCE_LISTING_NS = "true";
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
    mockDb.listingAttributeValue.findFirst.mockResolvedValue(null);
    const { WRITE_OFF_SUBMIT_ERROR } = await import(
      "@/lib/listings/write-off-category"
    );

    try {
      await expect(
        payForListing({
          listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
          privateSellerTermsAccepted: true,
        }),
      ).resolves.toEqual({
        error: WRITE_OFF_SUBMIT_ERROR,
      });
      expect(createListingCheckoutMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.POLICY_ENFORCE_LISTING_NS;
      } else {
        process.env.POLICY_ENFORCE_LISTING_NS = previous;
      }
    }
  });

  it("refuses checkout for an admin-owned listing", async () => {
    requireAuthMock.mockResolvedValue({
      id: "admin_1",
      email: "admin@example.com",
      role: "ADMIN",
      dealerProfile: { id: "dealer-admin", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "admin_1",
      dealerId: null,
      status: "DRAFT",
      title: "Admin private listing",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      category: {
        slug: "car",
        attributeDefinitions: [],
      },
    });
    mockDb.listingAttributeValue.findFirst.mockResolvedValue({ value: "None" });

    const { ADMIN_OWNED_LISTING_ERROR } = await import(
      "@/lib/listings/seller-access"
    );
    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({ error: ADMIN_OWNED_LISTING_ERROR });
    await expect(
      upgradeFeatured("caaaaaaaaaaaaaaaaaaaaaaaa"),
    ).resolves.toEqual({ error: ADMIN_OWNED_LISTING_ERROR });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });

  it("T6 T11 never skips payment for a non-owner admin", async () => {
    requireAuthMock.mockResolvedValue({
      id: "admin_1",
      email: "admin@example.com",
      role: "ADMIN",
      dealerProfile: { id: "dealer-admin", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "seller_1",
      dealerId: null,
      status: "DRAFT",
      title: "Someone else listing",
    });

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      error: "Not authorized",
    });
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
  });
});

describe("createDealerSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", "test-checkout-context-secret-at-least-32-characters");
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "dealer@example.com",
      name: "Ada Lovelace",
      dealerProfile: { id: "caaaaaaaaaaaaaaaaaaaaaaaa", name: "A1 Motors" },
    });
    checkRateLimitMock.mockReturnValue({ allowed: true });
    makeRateLimitKeyMock.mockReturnValue("checkout-dealer-subscription:user_123");
    getMarketplacePricingMock.mockResolvedValue({
      privateListingPence: 499,
      featuredUpgradePence: 500,
      dealerStarterMonthlyPence: 3999,
      dealerProMonthlyPence: 5999,
      optionalListingSupportPence: 500,
    });
    createDealerSubscriptionCheckoutMock.mockResolvedValue({
      url: "https://portal.startyourripple.co.uk/card/client/pay/C5D44F6F18094B94",
      merchantReference: "signed-subscription-reference",
    });
    getDealerPlanPricePenceMock.mockImplementation(
      (pricing, tier) =>
        tier === "PRO"
          ? pricing.dealerProMonthlyPence
          : pricing.dealerStarterMonthlyPence,
    );
    mockDb.policyAcceptance.upsert.mockResolvedValue({ id: "acc_1" });
  });

  it("uses the server-managed dealer amount when creating checkout POL-PAY-001-A", async () => {
    await expect(
      createDealerSubscription({
        tier: "PRO",
        acceptedDealerTerms: true,
      }),
    ).resolves.toEqual({
      data: {
        checkoutUrl:
          "https://portal.startyourripple.co.uk/card/client/pay/C5D44F6F18094B94?reference=signed-subscription-reference",
      },
    });

    expect(createDealerSubscriptionCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "PRO",
        amountInPence: 5999,
        payer: { dealerName: "A1 Motors", accountName: "Ada Lovelace", email: "dealer@example.com" },
      }),
    );
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalled();
    expect(decodeHostedReturnContext(setCookieMock.mock.calls[0][1])).toMatchObject({
      kind: "dealer_subscription", userId: "user_123", dealerId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      productCode: "C5D44F6F18094B94", email: "dealer@example.com",
    });
  });

  it("rejects the test subscription on production even when its URL is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RIPPLE_CLIENT_ID", "client");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", "https://portal.startyourripple.co.uk/card/client/pay/FE936242500F44E4");
    await expect(createDealerSubscription({ testPlan: true, acceptedDealerTerms: true })).resolves.toEqual({
      error: "The weekly test subscription is no longer available for new signups.",
    });
    expect(createDealerSubscriptionCheckoutMock).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it.each([true, false])("blocks new preview subscriptions including testPlan=%s before side effects", async (testPlan) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RIPPLE_CLIENT_ID", "client");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", "https://portal.startyourripple.co.uk/card/client/pay/FE936242500F44E4");
    createDealerSubscriptionCheckoutMock.mockResolvedValue({
      url: "https://portal.startyourripple.co.uk/card/client/pay/FE936242500F44E4",
      merchantReference: "signed-weekly-reference",
    });
    const result = await createDealerSubscription({ testPlan, tier: "PRO", acceptedDealerTerms: true });
    expect(result).toEqual({
      error: "New payments are disabled on preview. Existing subscriptions continue to renew.",
    });
    expect(createDealerSubscriptionCheckoutMock).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("blocks new preview featured purchases before database writes", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await upgradeFeatured("caaaaaaaaaaaaaaaaaaaaaaaa")).toEqual({
      error: "New payments are disabled on preview. Existing subscriptions continue to renew.",
    });
    expect(mockDb.payment.create).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("allows an eligible free LIVE listing to buy a standalone Featured upgrade", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa", userId: "user_123", dealerId: null,
      status: "LIVE", featured: false, title: "Free live listing",
    });
    mockDb.freeListingClaim.findUnique.mockResolvedValue({ id: "claim-1", userId: "user_123" });
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.payment.create.mockImplementation(async ({ data }) => ({
      id: "pending-pay",
      status: "PENDING",
      ...data,
    }));

    const result = await upgradeFeatured("caaaaaaaaaaaaaaaaaaaaaaaa");

    expect(result).toEqual({ data: { checkoutUrl: expect.any(String) } });
    expect(createFeaturedUpgradeCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      payer: { dealerName: "A1 Motors", accountName: "Ada Lovelace", email: "dealer@example.com" },
    }));
    expect(mockDb.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "FEATURED",
        status: "PENDING",
        paymentProvider: "RIPPLE",
      }),
    });
    expect(persistCheckoutAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "FEATURED_UPGRADE",
        paymentId: "pending-pay",
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        merchantReference: "featured-reference-new",
      }),
    );
  });

  it("reuses a compatible pending Featured checkout reference rather than orphaning it", async () => {
    const pending = {
      id: "featured-pending", status: "PENDING", type: "FEATURED",
      amount: 500, includesFeatured: false,
      providerReference: "persisted-featured-reference",
    };
    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa", userId: "user_123", dealerId: null,
      status: "LIVE", featured: false, title: "Paid live listing",
    });
    mockDb.payment.findFirst.mockImplementation(async ({ where }) => {
      if (where.type === "LISTING" && where.status === "SUCCEEDED") return { id: "listing-paid" };
      if (where.status === "PENDING" && where.type === "FEATURED" && typeof where.amount === "object") return null;
      if (where.status === "PENDING" && where.type === "FEATURED") return pending;
      return null;
    });

    const result = await upgradeFeatured("caaaaaaaaaaaaaaaaaaaaaaaa");
    if (!result.data?.checkoutUrl) throw new Error("Expected a Featured checkout URL");
    const url = new URL(result.data.checkoutUrl);

    expect(url.searchParams.get("reference")).toBe("persisted-featured-reference");
    expect(mockDb.payment.create).not.toHaveBeenCalled();
    expect(setCookieMock).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Object));
    expect(decodeHostedReturnContext(setCookieMock.mock.calls[0][1])).toMatchObject({
      kind: "featured_upgrade", merchantReference: "persisted-featured-reference",
    });
  });

  it("does not record acceptance or open checkout without acknowledgement POL-ACC-001-A", async () => {
    await expect(
      createDealerSubscription({
        tier: "PRO",
        acceptedDealerTerms: false,
      }),
    ).resolves.toEqual({
      error: expect.anything(),
    });

    expect(createDealerSubscriptionCheckoutMock).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
  });
});

describe("demo payment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutableEnvironment.NODE_ENV = "production";
    getMarketplacePricingMock.mockResolvedValue({
      privateListingPence: 749,
      featuredUpgradePence: 875,
      dealerStarterMonthlyPence: 3999,
      dealerProMonthlyPence: 5999,
      optionalListingSupportPence: 500,
    });
  });

  it("blocks demo listing payment simulation when live checkout is configured", async () => {
    isDemoListingCheckoutConfiguredMock.mockReturnValue(false);

    await expect(
      simulateDemoListingPaymentOutcome({
        listingId: "listing_123",
        flow: "private",
        outcome: "success",
      })
    ).resolves.toEqual({
      error: "Temporary demo payment controls are only available in development.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });

  it("blocks demo listing payment simulation in production even if demo checkout is active", async () => {
    isDemoListingCheckoutConfiguredMock.mockReturnValue(true);

    await expect(
      simulateDemoListingPaymentOutcome({
        listingId: "listing_123",
        flow: "private",
        outcome: "success",
      })
    ).resolves.toEqual({
      error: "Temporary demo payment controls are only available in development.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });

  it("blocks demo dealer subscription simulation when live checkout is configured", async () => {
    isDemoDealerSubscriptionCheckoutConfiguredMock.mockReturnValue(false);

    await expect(
      simulateDemoDealerSubscriptionOutcome({
        tier: "STARTER",
        outcome: "success",
      })
    ).resolves.toEqual({
      error: "Temporary demo payment controls are only available in development.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });

  it("does not record policy acceptance from the demo emulator POL-PAY-001-A", async () => {
    mutableEnvironment.NODE_ENV = "development";
    isDemoDealerSubscriptionCheckoutConfiguredMock.mockReturnValue(true);
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "dealer@example.com",
      dealerProfile: { id: "caaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    processProviderWebhookEventMock.mockResolvedValue({});

    await simulateDemoDealerSubscriptionOutcome({
      tier: "STARTER",
      outcome: "success",
    });

    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
  });

  it("blocks demo dealer subscription simulation in production even if demo checkout is active", async () => {
    isDemoDealerSubscriptionCheckoutConfiguredMock.mockReturnValue(true);

    await expect(
      simulateDemoDealerSubscriptionOutcome({
        tier: "STARTER",
        outcome: "success",
      })
    ).resolves.toEqual({
      error: "Temporary demo payment controls are only available in development.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });
});
