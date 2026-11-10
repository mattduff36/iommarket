import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchControls } from "@/components/marketplace/search/search-controls";
import { HeroSearch } from "@/components/marketplace/hero-search";

const { mockDb, visibility } = vi.hoisted(() => ({
  visibility: vi.fn(async ({ includeSold }: { includeSold?: boolean }) => ({
    status: { in: includeSold ? ["LIVE", "SOLD"] : ["LIVE"] }, id: { not: "hidden" },
  })),
  mockDb: {
    category: { findFirst: vi.fn(), findMany: vi.fn() },
    region: { findMany: vi.fn() },
    attributeDefinition: { findMany: vi.fn() },
    dealerProfile: { findMany: vi.fn() },
    listing: { findMany: vi.fn(), count: vi.fn() },
    listingAttributeValue: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/listings/expiry", () => ({ expireStaleLiveListings: vi.fn() }));
vi.mock("@/lib/listings/marketplace", async (original) => ({
  ...await original<typeof import("@/lib/listings/marketplace")>(),
  marketplaceListingWhereWithSettings: visibility,
}));
vi.mock("@/lib/listings/sample-visibility", () => ({
  getSampleVisibility: async () => ({ privateListings: true, dealerListings: true }),
}));
vi.mock("@/lib/config/marketplace-pricing", () => ({
  getMarketplacePricing: async () => ({ privateListingPence: 499, featuredUpgradePence: 500 }),
}));
vi.mock("@/lib/dealers/spotlights", () => ({
  getMarketplaceDealerSpotlightQuery: () => ({}), shuffleDealerSpotlights: (rows: unknown[]) => rows,
}));

import SearchPage from "@/app/(public)/search/page";
import HomePage from "@/app/(public)/page";

function componentProps(node: ReactNode, component: unknown): unknown {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === component) return child.props;
    const found = componentProps(child.props.children, component);
    if (found) return found;
  }
  return null;
}

const rows = [
  { id: "alias", status: "LIVE", make: "VW", model: "GOLF GTI" },
  { id: "canonical", status: "LIVE", make: "Volkswagen", model: "Golf GTI" },
  { id: "trim", status: "LIVE", make: "VOLKSWAGEN", model: "Golf GTE" },
  { id: "sold", status: "SOLD", make: "VW", model: "GOLF GTI" },
  { id: "hidden", status: "LIVE", make: "VW", model: "GOLF GTI" },
  { id: "preview", status: "ADMIN_PREVIEW", make: "VW", model: "GOLF GTI" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.category.findFirst.mockResolvedValue({ id: "car", slug: "car", name: "Cars" });
  mockDb.category.findMany.mockResolvedValue([]);
  mockDb.region.findMany.mockResolvedValue([]);
  mockDb.dealerProfile.findMany.mockResolvedValue([]);
  mockDb.listing.findMany.mockResolvedValue([]);
  mockDb.listing.count.mockResolvedValue(0);
  mockDb.attributeDefinition.findMany.mockImplementation(async ({ where }) => [{ id: where.slug }]);
  mockDb.listingAttributeValue.findMany.mockImplementation(async ({ where }) => {
    const slug = where.attributeDefinition?.slug ?? where.attributeDefinitionId.in[0];
    const visible = rows.filter((row) =>
      where.listing.status.in.includes(row.status) && row.id !== where.listing.id.not,
    );
    return visible.map((row) => ({
      listingId: row.id, value: slug === "make" ? row.make : row.model,
      listing: { status: row.status, category: { slug: "car", name: "Cars" } },
    }));
  });
});

describe("public normalization integration", () => {
  it.each([false, true])("matches legacy aliases with includeSold=%s while facets remain live-only", async (includeSold) => {
    const tree = await SearchPage({
      searchParams: Promise.resolve({
        category: "car", make: "VW", model: "GOLF GTI", ...(includeSold ? { includeSold: "true" } : {}),
      }),
    });
    const fence = {
      status: { in: includeSold ? ["LIVE", "SOLD"] : ["LIVE"] }, id: { not: "hidden" },
    };
    for (const [index, [query]] of mockDb.listingAttributeValue.findMany.mock.calls.entries()) {
      expect(query.where.listing).toEqual(index === 2
        ? { status: { in: ["LIVE"] }, id: { not: "hidden" } }
        : fence);
    }
    expect(mockDb.listing.count).toHaveBeenCalledWith({
      where: {
        categoryId: "car",
        AND: [fence, { id: { in: includeSold ? ["alias", "canonical", "sold"] : ["alias", "canonical"] } }],
      },
    });
    expect(componentProps(tree, SearchControls)).toMatchObject({
      initial: { make: "Volkswagen", model: "Golf GTI" },
      makes: [{ label: "Volkswagen", value: "Volkswagen", count: 3 }],
      modelsByMake: { Volkswagen: ["Golf GTE", "Golf GTI"] },
      modelCountsByMake: { Volkswagen: { "Golf GTI": 2, "Golf GTE": 1 } },
    });
  });

  it("combines canonical homepage counts inside the existing visibility fence", async () => {
    const tree = await HomePage();
    expect(componentProps(tree, HeroSearch)).toMatchObject({
      inventoryByCategory: {
        car: {
          makes: [{ label: "Volkswagen", value: "Volkswagen", count: 3 }],
          modelCountsByMake: { Volkswagen: { "Golf GTI": 2, "Golf GTE": 1 } },
        },
      },
    });
    for (const [query] of mockDb.listingAttributeValue.findMany.mock.calls) {
      expect(query.where.listing).toEqual({ status: { in: ["LIVE"] }, id: { not: "hidden" } });
    }
  });
});
