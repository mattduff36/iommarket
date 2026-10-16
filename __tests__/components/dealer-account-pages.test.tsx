// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealerListingsRedirectTarget } from "@/components/account/dealer-account-page";

const {
  redirectMock,
  requireAcceptedUserMock,
  hasOperationalDealerAccessMock,
  getCurrentDealerEntitlementMock,
  expireStaleLiveListingsMock,
  getMarketplacePricingMock,
  getPolicyFlagsMock,
  isTradeExchangeEnabledMock,
  loadTradeSessionMock,
  tradeStockSummaryMock,
  toManagedDealerReviewMock,
  dbMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  requireAcceptedUserMock: vi.fn(),
  hasOperationalDealerAccessMock: vi.fn(),
  getCurrentDealerEntitlementMock: vi.fn(),
  expireStaleLiveListingsMock: vi.fn(),
  getMarketplacePricingMock: vi.fn(),
  getPolicyFlagsMock: vi.fn(),
  isTradeExchangeEnabledMock: vi.fn(),
  loadTradeSessionMock: vi.fn(),
  tradeStockSummaryMock: vi.fn(),
  toManagedDealerReviewMock: vi.fn((review: { id: string }) => ({ id: review.id })),
  dbMock: {
    listing: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    dealerReview: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    dealerCancellationRequest: {
      findFirst: vi.fn(),
    },
    dealerCorrespondenceSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: requireAcceptedUserMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  hasOperationalDealerAccess: hasOperationalDealerAccessMock,
  getCurrentDealerEntitlement: getCurrentDealerEntitlementMock,
}));

vi.mock("@/lib/listings/expiry", () => ({
  expireStaleLiveListings: expireStaleLiveListingsMock,
}));

vi.mock("@/lib/config/marketplace-pricing", () => ({
  getMarketplacePricing: getMarketplacePricingMock,
}));

vi.mock("@/lib/policy/flags", () => ({
  getPolicyFlags: getPolicyFlagsMock,
}));

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

vi.mock("@/lib/trade-exchange/flag", () => ({
  isTradeExchangeEnabled: () => isTradeExchangeEnabledMock(),
}));

vi.mock("@/lib/trade-exchange/session", () => ({
  loadTradeSession: loadTradeSessionMock,
}));

vi.mock("@/lib/trade-exchange/maintenance", () => ({
  tradeStockSummary: tradeStockSummaryMock,
}));

vi.mock("@/lib/reviews/dealer-review-client", () => ({
  toManagedDealerReview: (review: { id: string }) => toManagedDealerReviewMock(review),
}));

vi.mock("@/lib/search/attribute-sort", () => ({
  findListingsInAttributeOrder: vi.fn(),
}));

vi.mock("@/app/(public)/dealer/dashboard/cancellation-request-card", () => ({
  CancellationRequestCard: ({ enabled }: { enabled: boolean }) => `cancellation:${String(enabled)}`,
}));

vi.mock("@/app/(public)/dealer/dashboard/dealer-review-response-manager", () => ({
  DealerReviewResponseManager: ({ reviews }: { reviews: Array<{ id: string }> }) =>
    `review-manager:${reviews.map((review) => review.id).join(",")}`,
}));

vi.mock("@/app/(public)/dealer/dashboard/dealer-correspondence-settings", () => ({
  DealerCorrespondenceSettingsCard: ({ primaryEmail }: { primaryEmail: string }) =>
    `correspondence:${primaryEmail}`,
}));

vi.mock("@/components/account/account-listing-actions", () => ({
  AccountListingActions: ({
    hasListingPayment,
    featuredUpgradePricePence,
  }: {
    hasListingPayment: boolean;
    featuredUpgradePricePence: number;
  }) => `actions:${String(hasListingPayment)}:${featuredUpgradePricePence}`,
}));

const dealer = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  role: "DEALER" as const,
  dealerProfile: {
    id: "dealer-1",
    slug: "ada-motors",
    name: "Ada Motors",
    bio: "Island stock",
    website: "https://example.com",
    phone: "01624 000000",
    logoUrl: "https://example.com/logo.png",
    tier: "STARTER" as const,
  },
};

const listing = {
  id: "listing-1",
  title: "Ford Focus",
  price: 250000,
  status: "LIVE",
  featured: false,
  featuredPurchased: false,
  expiresAt: null,
  dealerId: "dealer-1",
  lifecycleRevision: 2,
  category: { name: "Cars" },
  region: { name: "Douglas" },
  payments: [{ id: "pay-1" }],
};

function dealerWhere(call: { where?: { dealerId?: string } } | undefined) {
  return call?.where?.dealerId;
}

describe("dealer account pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedUserMock.mockResolvedValue(dealer);
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    getCurrentDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "sub-1",
      source: "PAYMENT",
      tier: "STARTER",
      endsAt: new Date("2026-12-01T00:00:00Z"),
    });
    expireStaleLiveListingsMock.mockResolvedValue(undefined);
    getMarketplacePricingMock.mockResolvedValue({ featuredUpgradePence: 875 });
    getPolicyFlagsMock.mockReturnValue({ enableCancellationRequests: true });
    isTradeExchangeEnabledMock.mockReturnValue(false);
    dbMock.listing.groupBy.mockResolvedValue([
      { status: "LIVE", _count: { _all: 2 } },
      { status: "DRAFT", _count: { _all: 1 } },
    ]);
    dbMock.listing.findMany.mockResolvedValue([listing]);
    dbMock.listing.count.mockResolvedValue(1);
    dbMock.dealerReview.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { _all: 2 },
    });
    dbMock.dealerReview.findMany.mockResolvedValue([
      { id: "review-1", rating: 5, comment: "Good", createdAt: new Date(), response: null, disputes: [] },
    ]);
    dbMock.dealerCancellationRequest.findFirst.mockResolvedValue({
      status: "REQUESTED",
      periodEndAt: new Date("2026-12-01T00:00:00Z"),
    });
    dbMock.dealerCorrespondenceSettings.findUnique.mockResolvedValue(null);
  });

  it("keeps admins out of the dealer overview", async () => {
    requireAcceptedUserMock.mockResolvedValue({ ...dealer, role: "ADMIN" });
    const { default: Page } = await import("@/app/(public)/dealer/dashboard/page");

    await expect(Page({})).rejects.toThrow("redirect:/admin");
    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/dashboard");
    expect(dbMock.listing.findMany).not.toHaveBeenCalled();
  });

  it("sends dealers without operational access to subscribe", async () => {
    hasOperationalDealerAccessMock.mockResolvedValue(false);
    const { default: Page } = await import("@/app/(public)/dealer/reviews/page");

    await expect(Page()).rejects.toThrow("redirect:/dealer/subscribe");
    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/reviews");
  });

  it("redirects old dashboard listing bookmarks after the dashboard gate", async () => {
    const { default: Page } = await import("@/app/(public)/dealer/dashboard/page");

    await expect(
      Page({ searchParams: Promise.resolve({ q: "ford", status: "LIVE", sort: "price_low", page: "2" }) }),
    ).rejects.toThrow("redirect:/dealer/listings?q=ford&status=LIVE&sort=price_low&page=2");
    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/dashboard");
    expect(dealerListingsRedirectTarget({ status: "<script>" })).toBeNull();
    expect(dealerListingsRedirectTarget({})).toBeNull();
  });

  it("shows a compact overview and keeps full controls off that page", async () => {
    isTradeExchangeEnabledMock.mockReturnValue(true);
    loadTradeSessionMock.mockResolvedValue({
      actor: {
        kind: "applicant",
        userId: "user-1",
        dealerId: "dealer-1",
        dealerName: "Ada Motors",
        tier: "STARTER",
        membershipStatus: "PENDING",
        proEntitled: false,
      },
      email: dealer.email,
    });
    const { default: Page } = await import("@/app/(public)/dealer/dashboard/page");
    render(await Page({}));

    expect(screen.getByRole("heading", { name: "Dealer overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New listing" }).getAttribute("href")).toBe("/sell/dealer");
    expect(screen.getByRole("link", { name: "Manage subscription" }).getAttribute("href")).toBe(
      "/dealer/subscription",
    );
    expect(screen.getByRole("link", { name: "View all listings" }).getAttribute("href")).toBe(
      "/dealer/listings",
    );
    expect(screen.getByRole("link", { name: "Open Trade Exchange" }).getAttribute("href")).toBe(
      "/dealer/trade",
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText(/review-manager/)).toBeNull();
    expect(screen.queryByText(/cancellation:/)).toBeNull();
    expect(screen.queryByText(/actions:/)).toBeNull();
    expect(tradeStockSummaryMock).not.toHaveBeenCalled();
    expect(dealerWhere(dbMock.listing.groupBy.mock.calls[0]?.[0])).toBe("dealer-1");
    expect(dbMock.listing.findMany.mock.calls[0]?.[0]?.where).toEqual({ dealerId: "dealer-1" });
    expect(dbMock.listing.findMany.mock.calls[0]?.[0]?.take).toBe(5);
  });

  it("keeps listing filters, sort, pagination, and payment action props on the listings page", async () => {
    dbMock.listing.count.mockResolvedValue(30);
    const { default: Page } = await import("@/app/(public)/dealer/listings/page");
    render(await Page({ searchParams: Promise.resolve({ q: "ford", status: "LIVE", sort: "price_low", page: "1" }) }));

    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/listings");
    expect(screen.getByRole("heading", { name: "Listings" })).toBeTruthy();
    const form = document.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/dealer/listings");
    expect(form?.getAttribute("method")).toBe("get");
    expect(screen.getByRole("option", { name: "APPROVED" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Mileage (lowest)" })).toBeTruthy();
    expect(screen.getByText("actions:false:875")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/dealer/listings?q=ford&status=LIVE&sort=price_low&page=2",
    );
    expect(dbMock.listing.findMany.mock.calls[0]?.[0]?.where).toEqual({
      dealerId: "dealer-1",
      title: { contains: "ford", mode: "insensitive" },
      status: "LIVE",
    });
    expect(dbMock.dealerReview.findMany).not.toHaveBeenCalled();
  });

  it("loads approved dealer reviews with the original response fields", async () => {
    const { default: Page } = await import("@/app/(public)/dealer/reviews/page");
    render(await Page());

    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/reviews");
    expect(screen.getByText("review-manager:review-1")).toBeTruthy();
    const query = dbMock.dealerReview.findMany.mock.calls[0]?.[0];
    expect(query.where).toEqual({ dealerId: "dealer-1", status: "APPROVED" });
    expect(query.select.response.select.approvedBody).toBe(true);
    expect(query.select.response.select.revisions.select).toMatchObject({
      body: true,
      status: true,
      reasonCode: true,
    });
    expect(query.select.disputes.select).toMatchObject({
      status: true,
      reasonCode: true,
      decisionReasonCode: true,
    });
    expect(toManagedDealerReviewMock).toHaveBeenCalledWith(expect.objectContaining({ id: "review-1" }));
  });

  it("loads correspondence for the signed-in dealer and points optional alerts elsewhere", async () => {
    const { default: Page } = await import("@/app/(public)/dealer/email-settings/page");
    render(await Page());

    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/email-settings");
    expect(screen.getByText("correspondence:ada@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Notification preferences" }).getAttribute("href")).toBe(
      "/account/notifications",
    );
    expect(dbMock.dealerCorrespondenceSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dealerId: "dealer-1" } }),
    );
  });

  it("shows cancellation only for paid entitlements and the original policy flag", async () => {
    const { default: Page } = await import("@/app/(public)/dealer/subscription/page");
    render(await Page());

    expect(requireAcceptedUserMock).toHaveBeenCalledWith("/dealer/subscription");
    expect(screen.getByRole("heading", { name: "Subscription" })).toBeTruthy();
    expect(screen.getByText("cancellation:true")).toBeTruthy();
    expect(screen.getByText("Starter plan")).toBeTruthy();
    expect(dbMock.dealerCancellationRequest.findFirst.mock.calls[0]?.[0]?.where).toEqual({
      dealerId: "dealer-1",
      status: { in: ["REQUESTED", "ACKNOWLEDGED", "RECONCILED"] },
    });
  });

  it("does not load cancellation for a complimentary grant", async () => {
    getCurrentDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "grant-1",
      source: "ADMIN_GRANT",
      tier: "PRO",
      endsAt: new Date("2026-12-01T00:00:00Z"),
    });
    const { default: Page } = await import("@/app/(public)/dealer/subscription/page");
    render(await Page());

    expect(screen.getByText("Free access")).toBeTruthy();
    expect(screen.queryByText(/cancellation:/)).toBeNull();
    expect(dbMock.dealerCancellationRequest.findFirst).not.toHaveBeenCalled();
  });
});
