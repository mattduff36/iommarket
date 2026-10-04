// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNodeEnv } from "@/__tests__/lib/seo-test-env";
import { stubProductionFrontend, stubVerifiedStaging } from "@/__tests__/lib/verified-staging-env";
import { buildDealerProfilePath } from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const getCurrentUserMock = vi.fn();
const getDealerEntitlementMock = vi.fn();
const expireStaleLiveListingsMock = vi.fn();
const liveListingWhereMock = vi.fn(() => ({ status: "LIVE" }));
const marketplaceListingWhereMock = vi.fn(() => ({ status: "LIVE" }));
const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const findHistoricalSlugMock = vi.fn();
const aggregateMock = vi.fn();
const findManyReviewsMock = vi.fn();
const getSampleVisibilityMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`permanentRedirect:${path}`);
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
  ADMIN_PREVIEW_BADGE: "Preview — not public",
}));

vi.mock("@/lib/listings/sample-visibility", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/listings/sample-visibility")
  >();
  return {
    ...actual,
    getSampleVisibility: getSampleVisibilityMock,
    isHiddenSampleDealer: () => false,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
    },
    dealerProfileSlugHistory: {
      findUnique: findHistoricalSlugMock,
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
    vi.unstubAllEnvs();
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
    findHistoricalSlugMock.mockResolvedValue(null);
    getSampleVisibilityMock.mockResolvedValue({
      privateListings: true,
      dealerListings: true,
    });
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

    const previousNode = process.env.NODE_ENV;
    const previousVercel = process.env.VERCEL_ENV;
    const previousLaunch = process.env.PRODUCTION_LAUNCH_ENABLED;
    const previousUrl = process.env.NEXT_PUBLIC_APP_URL;
    setNodeEnv("production");
    process.env.VERCEL_ENV = "production";
    process.env.PRODUCTION_LAUNCH_ENABLED = "1";
    process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
    let metadata: Awaited<ReturnType<typeof generateMetadata>>;
    try {
      metadata = await generateMetadata({
        params: Promise.resolve({ slug: "douglas-auto-exchange" }),
      });
    } finally {
      setNodeEnv(previousNode);
      if (previousVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercel;
      if (previousLaunch === undefined) delete process.env.PRODUCTION_LAUNCH_ENABLED;
      else process.env.PRODUCTION_LAUNCH_ENABLED = previousLaunch;
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
    }

    expect(metadata.alternates?.canonical).toBe(
      buildCanonicalUrl(
        buildDealerProfilePath("douglas-auto-exchange-canonical"),
      ),
    );
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/og/itrader-social.png?v=official-20261003", width: 1200, height: 630 }),
    ]);
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "douglas-auto-exchange" },
      }),
    );
  });

  it("uses a sized social card instead of advertising the raw dealer logo", async () => {
    findUniqueMock.mockResolvedValue({ ...buildDealer({ verified: true }), logoUrl: "https://example.com/logo.png" });
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "douglas-auto-exchange" }) });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/dealers/douglas-auto-exchange/social-image", width: 1200, height: 630 }),
    ]);
  });

  it("permanently redirects an eligible historical address to the current slug", async () => {
    findHistoricalSlugMock.mockResolvedValue({
      dealer: {
        id: "dealer-1",
        name: "Douglas Auto Exchange",
        slug: "douglas-auto-exchange-current",
        tier: "STARTER",
        isAdminPreview: false,
        previewPack: null,
        userId: "user-1",
        user: {
          role: "DEALER",
          authUserId: "auth-user-1",
          disabledAt: null,
          deletedAt: null,
        },
      },
    });
    findUniqueMock.mockResolvedValue(null);

    await expect(
      DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange-old" }),
      }),
    ).rejects.toThrow("permanentRedirect:/dealers/douglas-auto-exchange-current");
    expect(expireStaleLiveListingsMock).not.toHaveBeenCalled();
  });

  it("uses the current canonical URL for an eligible historical address", async () => {
    findUniqueMock.mockResolvedValue(null);
    findHistoricalSlugMock.mockResolvedValue({
      dealer: {
        id: "dealer-1",
        name: "Douglas Auto Exchange",
        bio: "Island dealership",
        slug: "douglas-auto-exchange-current",
        tier: "STARTER",
        isAdminPreview: false,
        previewPack: null,
        user: {
          role: "DEALER",
          authUserId: "auth-user-1",
          disabledAt: null,
          deletedAt: null,
        },
      },
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "douglas-auto-exchange-old" }),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        title: "Douglas Auto Exchange",
        alternates: {
          canonical: buildCanonicalUrl(
            buildDealerProfilePath("douglas-auto-exchange-current"),
          ),
        },
      }),
    );

    getDealerEntitlementMock.mockResolvedValue(null);
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "douglas-auto-exchange-old" }),
      }),
    ).resolves.toEqual({});
  });

  it("does not redirect a historical address when the current profile is no longer eligible", async () => {
    findHistoricalSlugMock.mockResolvedValue({
      dealer: {
        id: "dealer-1",
        name: "Douglas Auto Exchange",
        slug: "douglas-auto-exchange-current",
        tier: "STARTER",
        isAdminPreview: false,
        previewPack: null,
        userId: "user-1",
        user: {
          role: "DEALER",
          authUserId: "auth-user-1",
          disabledAt: null,
          deletedAt: null,
        },
      },
    });
    findUniqueMock.mockResolvedValue(null);
    getDealerEntitlementMock.mockResolvedValue(null);

    await expect(
      DealerProfilePage({
        params: Promise.resolve({ slug: "douglas-auto-exchange-old" }),
      }),
    ).rejects.toThrow("notFound");
  });

  it("T13 noindexes unpaid admin-viewable dealer profiles and hides them from users", async () => {
    stubVerifiedStaging();
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
    ).resolves.toEqual(
      expect.objectContaining({
        title: "Preview Motors",
        robots: { index: false, follow: false },
      }),
    );

    getCurrentUserMock.mockResolvedValue({ role: "USER" });
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    ).resolves.toEqual({});
  });

  it("lets a staging admin open a disabled preview dealer profile and 404s the public", async () => {
    stubVerifiedStaging();
    findUniqueMock.mockResolvedValue({
      ...buildDealer({ verified: false }),
      name: "Preview Motors",
      slug: "preview-motors",
      isAdminPreview: true,
      previewPack: {
        enabled: false,
        reviewRequired: true,
        reviewReasons: ["listing-has-no-valid-source-image"],
        reviewSourceRunId: "run-v",
      },
    });
    getDealerEntitlementMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    render(
      await DealerProfilePage({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Preview Motors" })).toBeTruthy();
    expect(screen.getByText("Preview — not public")).toBeTruthy();
    expect(screen.getByText("Disabled pack")).toBeTruthy();
    expect(screen.getByText("Needs manual review")).toBeTruthy();

    cleanup();
    getCurrentUserMock.mockResolvedValue({ id: "user-1", role: "USER" });
    await expect(
      DealerProfilePage({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    ).rejects.toThrow("notFound");
  });

  it("hides preview dealer profiles from production admins", async () => {
    stubProductionFrontend();
    findUniqueMock.mockResolvedValue({
      ...buildDealer({ verified: false }),
      name: "Preview Motors",
      slug: "preview-motors",
      isAdminPreview: true,
      previewPack: { enabled: true },
      user: {
        role: "DEALER",
        authUserId: "preview-system:preview-motors",
        disabledAt: null,
        deletedAt: null,
      },
    });
    getDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "sub-preview",
      source: "PAYMENT",
      tier: "STARTER",
      endsAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    getCurrentUserMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    ).resolves.toEqual({});
    await expect(
      DealerProfilePage({
        params: Promise.resolve({ slug: "preview-motors" }),
      }),
    ).rejects.toThrow("notFound");
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
        select: expect.objectContaining({
          response: { select: { approvedBody: true } },
        }),
      }),
    );
    const reviewWhere = JSON.stringify(findManyReviewsMock.mock.calls[0][0].where);
    expect(reviewWhere).toContain('"dealerId":"dealer-1"');
    expect(reviewWhere).toContain('"status":"APPROVED"');
    expect(reviewWhere).toContain('"isAdminPreview":false');
    expect(aggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        _avg: { rating: true },
        _count: { _all: true },
      }),
    );
    expect(JSON.stringify(aggregateMock.mock.calls[0][0].where)).toContain('"dealerId":"dealer-1"');
  });

  it("hides private-sample reviews when their visibility toggle is off", async () => {
    getSampleVisibilityMock.mockResolvedValue({
      privateListings: false,
      dealerListings: true,
    });
    findUniqueMock.mockResolvedValue(buildDealer({ verified: true }));

    await DealerProfilePage({
      params: Promise.resolve({ slug: "douglas-auto-exchange" }),
    });

    expect(
      JSON.stringify(aggregateMock.mock.calls[0][0].where),
    ).toContain("00000000-0000-0000-0000-");
    expect(findManyReviewsMock.mock.calls[0][0].where).toEqual(
      aggregateMock.mock.calls[0][0].where,
    );
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
