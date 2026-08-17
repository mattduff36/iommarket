import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const mocks = vi.hoisted(() => ({
  expireStaleLiveListings: vi.fn(),
  listingFindMany: vi.fn(),
  dealerFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
}));

vi.mock("@/lib/listings/expiry", () => ({
  expireStaleLiveListings: mocks.expireStaleLiveListings,
  liveListingWhere: () => ({ status: "LIVE" }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: { findMany: mocks.listingFindMany },
    dealerProfile: { findMany: mocks.dealerFindMany },
    category: { findMany: mocks.categoryFindMany },
  },
}));

const { default: sitemap } = await import("@/app/sitemap");

describe("sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expireStaleLiveListings.mockResolvedValue(undefined);
    mocks.listingFindMany.mockResolvedValue([
      {
        id: "listing/one",
        updatedAt: new Date("2026-08-16T00:00:00.000Z"),
      },
    ]);
    mocks.dealerFindMany.mockResolvedValue([
      {
        slug: "public/dealer",
        updatedAt: new Date("2026-08-15T00:00:00.000Z"),
      },
    ]);
    mocks.categoryFindMany.mockResolvedValue([
      {
        slug: "classic cars",
        createdAt: new Date("2026-08-14T00:00:00.000Z"),
      },
    ]);
  });

  it("includes first-class routes and only dealer rows selected by public rules", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(buildCanonicalUrl("/dealers"));
    expect(urls).toContain(buildCanonicalUrl("/contact"));
    expect(urls).toContain(buildCanonicalUrl("/vehicle-check"));
    expect(urls).toContain(
      buildCanonicalUrl("/listings/listing%2Fone"),
    );
    expect(urls).toContain(
      buildCanonicalUrl("/dealers/public%2Fdealer"),
    );
    expect(urls).not.toContain(
      buildCanonicalUrl("/dealers/private-dealer"),
    );
    expect(urls).toContain(
      buildCanonicalUrl("/search?category=classic+cars"),
    );
    expect(mocks.dealerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptions: {
            some: {
              OR: expect.any(Array),
            },
          },
          user: {
            role: { in: ["DEALER", "ADMIN"] },
            disabledAt: null,
            deletedAt: null,
          },
        }),
      }),
    );
    expect(mocks.categoryFindMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { slug: true, createdAt: true },
      orderBy: { sortOrder: "asc" },
    });
  });
});
