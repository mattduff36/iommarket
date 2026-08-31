import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSupportUrl = process.env.RIPPLE_LISTING_SUPPORT_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalEnforceAcceptance = process.env.POLICY_ENFORCE_ACCEPTANCE;
const mutableEnvironment = process.env as Record<string, string | undefined>;

const {
  requireAuthMock,
  isPrivateListingFreeForUserMock,
  createListingCheckoutMock,
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
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isPrivateListingFreeForUserMock: vi.fn(),
  createListingCheckoutMock: vi.fn(),
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
    },
    payment: {
      findFirst: vi.fn(),
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

vi.mock("@/lib/payments/webhook-processing", () => ({
  processProviderWebhookEvent: processProviderWebhookEventMock,
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
    createDealerSubscriptionCheckout: createDealerSubscriptionCheckoutMock,
    isDemoListingCheckoutConfigured: isDemoListingCheckoutConfiguredMock,
    isDemoDealerSubscriptionCheckoutConfigured:
      isDemoDealerSubscriptionCheckoutConfiguredMock,
  };
});

import {
  createDealerSubscription,
  payForListing,
  simulateDemoDealerSubscriptionOutcome,
  simulateDemoListingPaymentOutcome,
} from "@/actions/payments";

describe("payForListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.RIPPLE_LISTING_SUPPORT_URL;
    delete process.env.POLICY_ENFORCE_ACCEPTANCE;

    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
    });
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
    mockDb.listing.update.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      dealerId: null,
    });
  });

  afterEach(() => {
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
    });

    await expect(payForListing({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      privateSellerTermsAccepted: true,
    })).resolves.toEqual({
      data: {
        checkoutUrl: "https://checkout.example.com/listing-renewal",
      },
    });

    expect(createListingCheckoutMock).toHaveBeenCalledOnce();
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledOnce();
    expect(
      mockDb.policyAcceptance.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(createListingCheckoutMock.mock.invocationCallOrder[0]);
    expect(createListingCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountInPence: 749 }),
    );
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
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-paid",
      source: "PAYMENT",
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
    });
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
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-paid",
      source: "PAYMENT",
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
    });
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
    });
    await expect(
      payForListing({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { checkoutUrl: "https://checkout.example.com/listing-private" },
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

  it("T6 skips initial, renewal, and resubmission payment for an admin owner", async () => {
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

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      data: { checkoutUrl: null, skippedPayment: true },
    });

    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "admin_1",
      dealerId: null,
      status: "DRAFT",
      title: "Admin private initial listing",
      category: {
        slug: "car",
        attributeDefinitions: [],
      },
    });
    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      data: { checkoutUrl: null, skippedPayment: true },
    });

    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "admin_1",
      dealerId: "dealer-admin",
      status: "DRAFT",
      title: "Admin dealer listing",
      dealer: { tier: "STARTER" },
      category: {
        slug: "car",
        attributeDefinitions: [],
      },
    });
    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      data: { checkoutUrl: null, skippedPayment: true },
    });

    mockDb.listing.findUnique.mockResolvedValue({
      id: "caaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "admin_1",
      dealerId: "dealer-admin",
      status: "TAKEN_DOWN",
      title: "Admin dealer listing",
      dealer: { tier: "STARTER" },
      category: {
        slug: "car",
        attributeDefinitions: [],
      },
    });

    await expect(
      payForListing({ listingId: "caaaaaaaaaaaaaaaaaaaaaaaa" }),
    ).resolves.toEqual({
      data: { checkoutUrl: null, skippedPayment: true },
    });
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
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "dealer@example.com",
      dealerProfile: { id: "caaaaaaaaaaaaaaaaaaaaaaaa" },
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
      url: "https://checkout.example.com/dealer-pro",
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
      data: { checkoutUrl: "https://checkout.example.com/dealer-pro" },
    });

    expect(createDealerSubscriptionCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "PRO", amountInPence: 5999 }),
    );
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalled();
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
