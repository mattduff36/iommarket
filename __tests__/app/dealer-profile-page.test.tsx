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

  it("publishes only the approved response under an approved parent review MD-REV-001..003", async () => {
    findUniqueMock.mockResolvedValue(buildDealer({ verified: true }));
    aggregateMock.mockResolvedValue({
      _avg: { rating: 5 },
      _count: { _all: 1 },
    });
    findManyReviewsMock.mockResolvedValue([
      {
        id: "review-1",
        rating: 5,
        comment: "Helpful service",
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
        reviewerType: "REGISTERED",
        reviewerName: "Buyer",
        response: { approvedBody: "Thank you for your feedback." },
      },
    ]);

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    );

    expect(screen.getByText("Thank you for your feedback.")).toBeTruthy();
    expect(findManyReviewsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealerId: "dealer-1", status: "APPROVED" },
        select: expect.objectContaining({
          response: { select: { approvedBody: true } },
        }),
      }),
    );
    expect(aggregateMock).toHaveBeenCalledWith({
      where: { dealerId: "dealer-1", status: "APPROVED" },
      _avg: { rating: true },
      _count: { _all: true },
    });
  });

  it("does not publish a response for a rating-only review", async () => {
    findUniqueMock.mockResolvedValue(buildDealer({ verified: true }));
    findManyReviewsMock.mockResolvedValue([
      {
        id: "review-rating-only",
        rating: 4,
        comment: null,
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
        reviewerType: "ANONYMOUS",
        reviewerName: null,
        response: { approvedBody: "Must remain hidden" },
      },
    ]);

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    );
    expect(screen.queryByText("Must remain hidden")).toBeNull();
  });
});
