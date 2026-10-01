import { describe, expect, it } from "vitest";
import {
  combineMarketplaceListingWhere,
  marketplaceListingWhere,
} from "@/lib/listings/marketplace";
import { publicListingSellerWhere } from "@/lib/listings/dealer-visibility";
import { liveListingWhere } from "@/lib/listings/expiry";
import { sampleDealerListingWhere, samplePrivateListingWhere } from "@/lib/listings/sample-visibility";

describe("marketplace listing visibility", () => {
  it("keeps public and dealer viewers on LIVE-only queries", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({ viewer: null, now })).toEqual({ AND: [liveListingWhere(now), publicListingSellerWhere(now)] });
    expect(marketplaceListingWhere({ viewer: { role: "USER" }, now })).toEqual({ AND: [liveListingWhere(now), publicListingSellerWhere(now)] });
    expect(marketplaceListingWhere({ viewer: { role: "DEALER" }, now })).toEqual({ AND: [liveListingWhere(now), publicListingSellerWhere(now)] });
  });

  it("adds enabled ADMIN_PREVIEW rows only for admins by default", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({ viewer: { role: "ADMIN" }, now })).toEqual({
      OR: [
        { AND: [liveListingWhere(now), publicListingSellerWhere(now)] },
        { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
      ],
    });
  });

  it("never puts ADMIN_PREVIEW into the public sitemap query", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(liveListingWhere(now)).toEqual({
      status: "LIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
    expect(JSON.stringify(liveListingWhere(now))).not.toContain("ADMIN_PREVIEW");
  });

  it("hides disabled packs by default and includes them for admin browse surfaces", () => {
    const adminWhere = marketplaceListingWhere({ viewer: { role: "ADMIN" } });
    expect(adminWhere).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
        ]),
      }),
    );
    expect(
      marketplaceListingWhere({
        viewer: { role: "ADMIN" },
        includeDisabledPreviewPacks: true,
      }),
    ).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([{ status: "ADMIN_PREVIEW" }]),
      }),
    );
    expect(
      JSON.stringify(
        marketplaceListingWhere({
          viewer: { role: "USER" },
          includeDisabledPreviewPacks: true,
        }),
      ),
    ).not.toContain("ADMIN_PREVIEW");
  });

  it("hides seed private listings without excluding preview-pack rows", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const where = marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      sampleVisibility: { privateListings: false, dealerListings: true },
    });
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { AND: [liveListingWhere(now), publicListingSellerWhere(now)] },
            { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
          ],
        },
        { NOT: samplePrivateListingWhere() },
      ],
    });
    expect(JSON.stringify(where)).not.toContain("preview-system:");
  });

  it("hides seed dealer listings without excluding preview-pack rows", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const where = marketplaceListingWhere({
      viewer: null,
      now,
      sampleVisibility: { privateListings: true, dealerListings: false },
    });
    expect(where).toEqual({
      AND: [{ AND: [liveListingWhere(now), publicListingSellerWhere(now, { privateListings: true, dealerListings: false })] }, { NOT: sampleDealerListingWhere() }],
    });
  });

  it("keeps visibility filters nested when text and attribute clauses are added", () => {
    const visibility = {
      OR: [
        { status: "LIVE" as const },
        { status: "SOLD" as const },
      ],
    };
    const where = combineMarketplaceListingWhere({
      visibility,
      filters: {
        id: { in: ["numeric-match"] },
        dealerId: { not: null },
      },
      clauses: [
        { OR: [{ title: { contains: "focus" } }, { description: { contains: "focus" } }] },
        { attributeValues: { some: { value: "Ford" } } },
      ],
    });
    expect(where).toEqual({
      dealerId: { not: null },
      id: { in: ["numeric-match"] },
      AND: [
        visibility,
        { OR: [{ title: { contains: "focus" } }, { description: { contains: "focus" } }] },
        { attributeValues: { some: { value: "Ford" } } },
      ],
    });
  });
});
