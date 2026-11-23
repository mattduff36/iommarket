import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadGoogleAnalytics } from "@/lib/analytics/google-analytics";

const { dbMock, expireStaleLiveListingsMock, getSampleVisibilityMock } = vi.hoisted(
  () => ({
    getSampleVisibilityMock: vi.fn(),
    expireStaleLiveListingsMock: vi.fn(),
    dbMock: {
      listingView: { count: vi.fn() },
      user: { count: vi.fn() },
      listing: { count: vi.fn(), findMany: vi.fn() },
      favourite: { count: vi.fn(), groupBy: vi.fn() },
      savedSearch: { count: vi.fn() },
      payment: { count: vi.fn() },
      subscription: { count: vi.fn() },
      $queryRaw: vi.fn(),
    },
  }),
);

const PLACEHOLDER_AUTH_PREFIX = "00000000-0000-0000-0000-";

vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/lib/listings/expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/expiry")>();
  return {
    ...actual,
    expireStaleLiveListings: expireStaleLiveListingsMock,
  };
});

vi.mock("@/lib/analytics/google-analytics", () => ({
  loadGoogleAnalytics: vi.fn(async () => ({
    status: "not-configured",
    users: 0,
    pageviews: 0,
    previousUsers: 0,
    previousPageviews: 0,
    sessions: 0,
    energyFmSessions: 0,
    series: [],
    events: [],
    devices: [],
    channels: [],
    countries: [],
    cities: [],
  })),
}));

vi.mock("@/lib/listings/sample-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/sample-visibility")>();
  return {
    ...actual,
    getSampleVisibility: getSampleVisibilityMock,
  };
});

describe("AdminAnalyticsPage sample visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expireStaleLiveListingsMock.mockResolvedValue(undefined);
    getSampleVisibilityMock.mockResolvedValue({
      privateListings: false,
      dealerListings: false,
    });
    dbMock.listingView.count.mockResolvedValue(0);
    dbMock.user.count.mockResolvedValue(0);
    dbMock.listing.count.mockResolvedValue(0);
    dbMock.listing.findMany.mockResolvedValue([]);
    dbMock.favourite.count.mockResolvedValue(0);
    dbMock.favourite.groupBy.mockResolvedValue([]);
    dbMock.savedSearch.count.mockResolvedValue(0);
    dbMock.payment.count.mockResolvedValue(0);
    dbMock.subscription.count.mockResolvedValue(0);
    dbMock.$queryRaw.mockResolvedValue([]);
  });

  it.each([
    ["available", 100, 12, "12% of all recorded visits"],
    ["no-data", 0, 0, "0% of all recorded visits"],
    ["error", 0, 0, "Analytics unavailable"],
  ] as const)("shows honest Energy FM metrics for %s data", async (status, sessions, energyFmSessions, detail) => {
    vi.mocked(loadGoogleAnalytics).mockResolvedValueOnce({
      status, sessions, energyFmSessions, users: 25, pageviews: 80,
      previousUsers: 0, previousPageviews: 0, series: [], events: [],
      devices: [], channels: [], countries: [], cities: [],
    });
    const { default: AdminAnalyticsPage } = await import("@/app/(admin)/admin/analytics/page");
    const html = renderToStaticMarkup(await AdminAnalyticsPage({ searchParams: Promise.resolve({ range: "7d" }) }));
    expect(html).toContain("Energy FM visits");
    expect(html).toContain(detail);
    if (status === "available") {
      expect(html).toContain("Energy FM banner");
      expect(html).toContain("12 visits · 12%");
    }
    if (status === "error") expect(html).toContain("—");
  });

  it("excludes disabled samples from every listing-backed metric", async () => {
    const { default: AdminAnalyticsPage } = await import(
      "@/app/(admin)/admin/analytics/page"
    );

    await AdminAnalyticsPage({});

    for (const [input] of dbMock.listingView.count.mock.calls) {
      expect(JSON.stringify(input.where)).toContain(PLACEHOLDER_AUTH_PREFIX);
    }
    expect(
      JSON.stringify(dbMock.favourite.count.mock.calls[0][0].where),
    ).toContain(PLACEHOLDER_AUTH_PREFIX);
    expect(
      JSON.stringify(dbMock.favourite.groupBy.mock.calls[0][0].where),
    ).toContain(PLACEHOLDER_AUTH_PREFIX);

    const rawQuery = dbMock.$queryRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(rawQuery.strings.join(" ")).toContain('dealer."isAdminPreview" = FALSE');
    expect(rawQuery.strings.join(" ")).toContain('viewer_dealer."isAdminPreview" = FALSE');
    expect(rawQuery.strings.join(" ")).toContain('listing."previewPackId" IS NULL');
    expect(rawQuery.strings.join(" ")).toContain("listing.\"status\" <> 'ADMIN_PREVIEW'");
    expect(
      rawQuery.values.filter(
        (value) => value === `${PLACEHOLDER_AUTH_PREFIX}%`,
      ),
    ).toHaveLength(4);
  });

  it("bounds activity and Google Analytics to completed London days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T23:30:00Z"));
    try {
      const { default: Page } = await import("@/app/(admin)/admin/analytics/page");
      const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range: "7d" }) }));
      const since = new Date("2026-06-29T23:00:00Z");
      const until = new Date("2026-07-06T23:00:00Z");
      expect(loadGoogleAnalytics).toHaveBeenCalledWith(expect.objectContaining({ since, until: new Date(until.getTime() - 1) }));
      const query = dbMock.$queryRaw.mock.calls[0][0];
      expect(query.values).toContainEqual(since);
      expect(query.values).toContainEqual(until);
      expect(query.strings.join(" ")).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London'");
      expect(query.strings.join(" ")).toContain('views."createdAt" <');
      expect(JSON.stringify(dbMock.listingView.count.mock.calls[1][0])).toContain(JSON.stringify({ gte: since, lt: until }));
      expect(html).toContain("Current marketplace");
    } finally { vi.useRealTimers(); }
  });
});
