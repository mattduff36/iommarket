import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const getDealerEntitlementMock = vi.fn();
const expireStaleLiveListingsMock = vi.fn();
const liveListingWhereMock = vi.fn(() => ({ status: "LIVE" }));
const findUniqueMock = vi.fn();
const aggregateMock = vi.fn();
const findManyReviewsMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  getDealerEntitlement: getDealerEntitlementMock,
}));

vi.mock("@/lib/listings/expiry", () => ({
  expireStaleLiveListings: expireStaleLiveListingsMock,
  liveListingWhere: liveListingWhereMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findUnique: findUniqueMock,
    },
    dealerReview: {
      aggregate: aggregateMock,
      findMany: findManyReviewsMock,
    },
  },
}));

vi.mock("@/components/dealers/dealer-logo", () => ({
  DealerLogo: ({ dealerName }: { dealerName: string }) => (
    <span data-testid="dealer-logo">{dealerName}</span>
  ),
}));

vi.mock("@/actions/dealer-reviews", () => ({
  submitDealerReview: vi.fn(),
}));

const { default: DealerProfilePage } = await import(
  "@/app/(public)/dealers/[slug]/page"
);

function buildDealer(overrides: { verified: boolean }) {
  return {
    id: "dealer-1",
    userId: "user-1",
    name: "Douglas Auto Exchange",
    slug: "douglas-auto-exchange",
    bio: "Island dealership",
    website: "https://example.com",
    phone: "01624 671234",
    logoUrl: null,
    tier: "STARTER",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    listings: [],
    user: {
      role: "DEALER",
      disabledAt: null,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("DealerProfilePage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    expireStaleLiveListingsMock.mockResolvedValue(undefined);
    getCurrentUserMock.mockResolvedValue(null);
    getDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "sub-1",
      source: "PAYMENT",
      tier: "STARTER",
      endsAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    aggregateMock.mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    });
    findManyReviewsMock.mockResolvedValue([]);
  });

  it("does not show Verified Dealer for a subscribed but unverified dealer", async () => {
    findUniqueMock.mockResolvedValue(buildDealer({ verified: false }));

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Douglas Auto Exchange" }),
    ).toBeTruthy();
    expect(screen.queryByText("Subscription Active")).toBeNull();
    expect(screen.queryByText("Verified Dealer")).toBeNull();
  });

  it("shows Verified Dealer only when an admin has verified the dealer", async () => {
    findUniqueMock.mockResolvedValue(buildDealer({ verified: true }));

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Douglas Auto Exchange" }),
    ).toBeTruthy();
    expect(screen.getByText("Verified Dealer")).toBeTruthy();
    expect(screen.queryByText("Subscription Active")).toBeNull();
  });
});
