import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDealerProfilePath } from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const getCurrentUserMock = vi.fn();
const getDealerEntitlementMock = vi.fn();
const expireStaleLiveListingsMock = vi.fn();
const liveListingWhereMock = vi.fn(() => ({ status: "LIVE" }));
const marketplaceListingWhereMock = vi.fn(() => ({ status: "LIVE" }));
const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
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
  getPaidSubscriptionEntitlementWhere: (now: Date) => ({
    source: "PAYMENT",
    status: "ACTIVE",
    currentPeriodEnd: { gt: now },
  }),
}));

vi.mock("@/lib/listings/expiry", () => ({
  expireStaleLiveListings: expireStaleLiveListingsMock,
  liveListingWhere: liveListingWhereMock,
}));

vi.mock("@/lib/listings/marketplace", () => ({
  marketplaceListingWhere: marketplaceListingWhereMock,
  marketplaceListingWhereWithSettings: async () => marketplaceListingWhereMock(),
  marketplaceListingBadge: () => undefined,
}));

vi.mock("@/lib/listings/sample-visibility", () => ({
  getSampleVisibility: async () => ({ privateListings: true, dealerListings: true }),
  isHiddenSampleDealer: () => false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
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

const {
  default: DealerProfilePage,
  generateMetadata,
} = await import(
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
    isAdminPreview: false,
    previewPack: null,
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

  it("adds a canonical URL only for a publicly eligible dealer", async () => {
    findUniqueMock.mockResolvedValue({
      id: "dealer-1",
      name: "Douglas Auto Exchange",
      bio: "Island dealership",
      slug: "douglas-auto-exchange-canonical",
      tier: "STARTER",
      isAdminPreview: false,
      previewPack: null,
      user: { role: "DEALER", disabledAt: null, deletedAt: null },
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "douglas-auto-exchange" }),
    });

    expect(metadata.alternates?.canonical).toBe(
      buildCanonicalUrl(
        buildDealerProfilePath("douglas-auto-exchange-canonical"),
      ),
    );
    expect(metadata.robots).toBeUndefined();
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "douglas-auto-exchange" },
      }),
    );
  });

  it("T13 noindexes unpaid admin-viewable dealer profiles and hides them from users", async () => {
    findUniqueMock.mockResolvedValue({
      id: "dealer-1",
      name: "Admin Motors",
      bio: "Staff dealer profile",
      slug: "admin-motors",
      tier: "STARTER",
      isAdminPreview: false,
      previewPack: null,
      user: { role: "ADMIN", disabledAt: null, deletedAt: null },
    });
    getDealerEntitlementMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ role: "ADMIN" });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "admin-motors" }),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        title: "Admin Motors",
        robots: { index: false, follow: false },
      }),
    );

    getCurrentUserMock.mockResolvedValue({ role: "USER" });
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "admin-motors" }),
      }),
    ).resolves.toEqual({});

    findUniqueMock.mockResolvedValue({
      id: "dealer-preview",
      name: "Preview Motors",
      bio: "Preview",
      slug: "preview-motors",
      tier: "STARTER",
      isAdminPreview: true,
      previewPack: { enabled: false },
      user: { role: "DEALER", disabledAt: null, deletedAt: null },
    });
    getCurrentUserMock.mockResolvedValue({ role: "ADMIN" });
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    ).resolves.toEqual({});
  });

  it("T13 lets an admin view an unpaid non-preview dealer page and 404s users", async () => {
    findUniqueMock.mockResolvedValue(buildDealer({ verified: false }));
    getDealerEntitlementMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Douglas Auto Exchange" }),
    ).toBeTruthy();

    cleanup();
    getCurrentUserMock.mockResolvedValue({ id: "user-1", role: "USER" });
    await expect(
      DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      }),
    ).rejects.toThrow("notFound");
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
