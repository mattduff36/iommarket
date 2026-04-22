import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSupportUrl = process.env.RIPPLE_LISTING_SUPPORT_URL;

const {
  requireAuthMock,
  isPrivateListingFreeForUserMock,
  createListingCheckoutMock,
  captureExceptionMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  getListingFeePenceMock,
  getFeaturedFeePenceMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isPrivateListingFreeForUserMock: vi.fn(),
  createListingCheckoutMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  getListingFeePenceMock: vi.fn(),
  getFeaturedFeePenceMock: vi.fn(),
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
  };
});

import { payForListing } from "@/actions/payments";

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
      return;
    }

    process.env.RIPPLE_LISTING_SUPPORT_URL = originalSupportUrl;
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
