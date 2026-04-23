import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSupportUrl = process.env.RIPPLE_LISTING_SUPPORT_URL;
const originalNodeEnv = process.env.NODE_ENV;

const {
  requireAuthMock,
  isPrivateListingFreeForUserMock,
  createListingCheckoutMock,
  processProviderWebhookEventMock,
  captureExceptionMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  getListingFeePenceMock,
  getFeaturedFeePenceMock,
  isDemoListingCheckoutConfiguredMock,
  isDemoDealerSubscriptionCheckoutConfiguredMock,
  revalidatePathMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isPrivateListingFreeForUserMock: vi.fn(),
  createListingCheckoutMock: vi.fn(),
  processProviderWebhookEventMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  getListingFeePenceMock: vi.fn(),
  getFeaturedFeePenceMock: vi.fn(),
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
  getListingFeePence: getListingFeePenceMock,
  getFeaturedFeePence: getFeaturedFeePenceMock,
  isPrivateListingFreeForUser: isPrivateListingFreeForUserMock,
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
    isDemoListingCheckoutConfigured: isDemoListingCheckoutConfiguredMock,
    isDemoDealerSubscriptionCheckoutConfigured:
      isDemoDealerSubscriptionCheckoutConfiguredMock,
  };
});

import {
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
    getListingFeePenceMock.mockReturnValue(499);
    getFeaturedFeePenceMock.mockReturnValue(500);
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
      delete process.env.NODE_ENV;
      return;
    }

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("skips optional support checkout for free private sellers when no support URL is configured", async () => {
    const result = await payForListing("caaaaaaaaaaaaaaaaaaaaaaaa", {
      supportAmountPence: 200,
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
});

describe("demo payment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    getListingFeePenceMock.mockReturnValue(499);
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
