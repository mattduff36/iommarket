import { describe, expect, it } from "vitest";
import { marketplaceListingWhere } from "@/lib/listings/marketplace";
import { liveListingWhere } from "@/lib/listings/expiry";
import { sampleDealerListingWhere, samplePrivateListingWhere } from "@/lib/listings/sample-visibility";

describe("marketplace listing visibility", () => {
  it("keeps public and dealer viewers on LIVE-only queries", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({ viewer: null, now })).toEqual(liveListingWhere(now));
    expect(marketplaceListingWhere({ viewer: { role: "USER" }, now })).toEqual(liveListingWhere(now));
    expect(marketplaceListingWhere({ viewer: { role: "DEALER" }, now })).toEqual(liveListingWhere(now));
  });

  it("adds enabled ADMIN_PREVIEW rows only for admins", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({ viewer: { role: "ADMIN" }, now })).toEqual({
      OR: [
        liveListingWhere(now),
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

  it("hides disabled packs and restores them when enabled is true", () => {
    const adminWhere = marketplaceListingWhere({ viewer: { role: "ADMIN" } });
    expect(adminWhere).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
        ]),
      }),
    );
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
            liveListingWhere(now),
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
      AND: [liveListingWhere(now), { NOT: sampleDealerListingWhere() }],
    });
  });
});
