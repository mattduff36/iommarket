import { beforeEach, describe, expect, it, vi } from "vitest";

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
    dbMock.$queryRaw.mockResolvedValue([]);
  });

  it("excludes disabled samples from every listing-backed metric", async () => {
    const { default: AdminAnalyticsPage } = await import(
      "@/app/(admin)/admin/analytics/page"
    );

    await AdminAnalyticsPage();

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
    expect(
      rawQuery.values.filter(
        (value) => value === `${PLACEHOLDER_AUTH_PREFIX}%`,
      ),
    ).toHaveLength(4);
  });
});
