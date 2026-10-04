import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  category: { findMany: vi.fn() },
  region: { findMany: vi.fn() },
  attributeDefinition: { findMany: vi.fn() },
  dealerProfile: { findMany: vi.fn() },
  listing: { count: vi.fn(), findMany: vi.fn() },
  listingAttributeValue: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/listings/expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/expiry")>();
  return {
    ...actual,
    expireStaleLiveListings: vi.fn(),
  };
});
vi.mock("@/lib/listings/sample-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/sample-visibility")>();
  return {
    ...actual,
    getSampleVisibility: async () => ({
      privateListings: true,
      dealerListings: true,
    }),
  };
});
vi.mock("@/lib/config/marketplace-pricing", () => ({
  getMarketplacePricing: async () => ({
    privateListingPence: 499,
    featuredUpgradePence: 500,
  }),
}));
vi.mock("@/lib/dealers/spotlights", () => ({
  getMarketplaceDealerSpotlightQuery: () => ({}),
  shuffleDealerSpotlights: (dealers: unknown[]) => dealers,
}));

describe("homepage sold visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.category.findMany.mockResolvedValue([]);
    dbMock.region.findMany.mockResolvedValue([]);
    dbMock.attributeDefinition.findMany.mockResolvedValue([]);
    dbMock.dealerProfile.findMany.mockResolvedValue([]);
    dbMock.listing.count.mockResolvedValue(0);
    dbMock.listing.findMany.mockResolvedValue([]);
    dbMock.listingAttributeValue.findMany.mockResolvedValue([]);
  });

  it("excludes disabled and hidden sellers from the SOLD count", async () => {
    const { default: HomePage } = await import("@/app/(public)/page");

    await HomePage();

    const soldWhere = JSON.stringify(dbMock.listing.count.mock.calls[0][0].where);
    expect(soldWhere).toContain('"status":"SOLD"');
    expect(soldWhere).toContain('"disabledAt":null');
    expect(soldWhere).toContain('"deletedAt":null');
    expect(soldWhere).toContain('"previewPackId":null');
    expect(soldWhere).toContain('"isAdminPreview":false');
  });
});
