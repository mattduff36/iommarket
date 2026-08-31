import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const requireAcceptedUserMock = vi.fn();
const ensureAdminDealerProfileMock = vi.fn();
const hasOperationalDealerAccessMock = vi.fn();
const getCurrentDealerEntitlementMock = vi.fn();
const expireStaleLiveListingsMock = vi.fn();
const getMarketplacePricingMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: requireAcceptedUserMock,
}));

vi.mock("@/lib/dealers/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dealers/access")>(
    "@/lib/dealers/access",
  );
  return {
    ...actual,
    ensureAdminDealerProfile: ensureAdminDealerProfileMock,
  };
});

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

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    dealerReview: {
      aggregate: vi.fn().mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    dealerCancellationRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    dealerProfile: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/app/(public)/dealer/dashboard/cancellation-request-card", () => ({
  CancellationRequestCard: () => null,
}));

vi.mock("@/app/(public)/dealer/dashboard/dealer-review-response-manager", () => ({
  DealerReviewResponseManager: () => null,
}));

describe("DealerDashboardPage T9", () => {
  const adminUser = {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    role: "ADMIN",
    dealerProfile: {
      id: "dealer-admin",
      slug: "admin-dealer",
      name: "Admin Dealer",
      bio: null,
      website: null,
      phone: null,
      logoUrl: null,
      tier: "STARTER",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    expireStaleLiveListingsMock.mockResolvedValue(undefined);
    requireAcceptedUserMock.mockResolvedValue({
      ...adminUser,
      dealerProfile: null,
    });
    ensureAdminDealerProfileMock.mockResolvedValue(adminUser);
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    getCurrentDealerEntitlementMock.mockResolvedValue(null);
    getMarketplacePricingMock.mockResolvedValue({
      featuredUpgradePence: 875,
    });
  });

  it("provisions a missing admin dealer profile and renders without billing entitlement", async () => {
    const { default: DealerDashboardPage } = await import(
      "@/app/(public)/dealer/dashboard/page"
    );

    render(await DealerDashboardPage({}));

    expect(ensureAdminDealerProfileMock).toHaveBeenCalled();
    expect(screen.getByText("Admin operational access")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Free access")).toBeNull();
    expect(screen.queryByText(/active listing slots used/i)).toBeNull();
  });
});
