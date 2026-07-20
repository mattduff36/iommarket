import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSupportUrl = process.env.RIPPLE_LISTING_SUPPORT_URL;
const originalNodeEnv = process.env.NODE_ENV;
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
    },
    subscription: {
      findFirst: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
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
      return;
    }

    mutableEnvironment.NODE_ENV = originalNodeEnv;
  });

  it("skips optional support checkout for free private sellers when no support URL is configured", async () => {
    const result = await payForListing("caaaaaaaaaaaaaaaaaaaaaaaa", {
      supportPlatform: true,
    });

    expect(result).toEqual({
      data: {
        checkoutUrl: null,
        skippedPayment: true,
      },
    });
    expect(isPrivateListingFreeForUserMock).toHaveBeenCalledWith("user_123");
    expect(createListingCheckoutMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
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

    await expect(payForListing("caaaaaaaaaaaaaaaaaaaaaaaa")).resolves.toEqual({
      data: {
        checkoutUrl: "https://checkout.example.com/listing-renewal",
      },
    });

    expect(createListingCheckoutMock).toHaveBeenCalledOnce();
    expect(createListingCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountInPence: 749 }),
    );
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
  });

  it("uses the server-managed dealer amount when creating checkout", async () => {
    await expect(createDealerSubscription("PRO")).resolves.toEqual({
      data: { checkoutUrl: "https://checkout.example.com/dealer-pro" },
    });

    expect(createDealerSubscriptionCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "PRO", amountInPence: 5999 }),
    );
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
      error:
        "Temporary demo payment controls are only available while Ripple demo checkout is active.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });

  it("allows demo listing payment simulation in production when demo checkout is active", async () => {
    isDemoListingCheckoutConfiguredMock.mockReturnValue(true);
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
    });

    await expect(
      simulateDemoListingPaymentOutcome({
        listingId: "listing_123",
        flow: "private",
        outcome: "success",
      })
    ).resolves.toEqual({
      data: {
        paymentStatus: "SUCCEEDED",
        nextUrl: "/sell/success?listing=listing_123&flow=private&payment=paid",
      },
    });

    expect(processProviderWebhookEventMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("blocks demo dealer subscription simulation when live checkout is configured", async () => {
    isDemoDealerSubscriptionCheckoutConfiguredMock.mockReturnValue(false);

    await expect(
      simulateDemoDealerSubscriptionOutcome({
        tier: "STARTER",
        outcome: "success",
      })
    ).resolves.toEqual({
      error:
        "Temporary demo payment controls are only available while Ripple demo checkout is active.",
    });

    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(processProviderWebhookEventMock).not.toHaveBeenCalled();
  });

  it("allows demo dealer subscription simulation in production when demo checkout is active", async () => {
    isDemoDealerSubscriptionCheckoutConfiguredMock.mockReturnValue(true);
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "dealer@example.com",
      role: "USER",
      dealerProfile: {
        id: "dealer_123",
      },
    });

    await expect(
      simulateDemoDealerSubscriptionOutcome({
        tier: "STARTER",
        outcome: "success",
      })
    ).resolves.toEqual({
      data: {
        subscriptionStatus: "ACTIVE",
        nextUrl: "/dealer/dashboard?subscribed=true",
      },
    });

    expect(processProviderWebhookEventMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalled();
  });
});
