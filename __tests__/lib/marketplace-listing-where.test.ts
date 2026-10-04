import { describe, expect, it } from "vitest";
import {
  combineMarketplaceListingWhere,
  marketplaceListingWhere,
} from "@/lib/listings/marketplace";
import { publicListingSellerWhere } from "@/lib/listings/dealer-visibility";
import { liveListingWhere } from "@/lib/listings/expiry";
import { sampleDealerListingWhere, samplePrivateListingWhere } from "@/lib/listings/sample-visibility";
import {
  excludePreviewPackListingsWhere,
  linkedPreviewPackListingWhere,
} from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

function publicMarketplace(now: Date, sample?: { privateListings: boolean; dealerListings: boolean }) {
  return {
    AND: [
      liveListingWhere(now),
      publicListingSellerWhere(now, sample),
      excludePreviewPackListingsWhere(),
    ],
  };
}

describe("marketplace listing visibility", () => {
  it("keeps production viewers, including admins, off preview-pack rows", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const production = {
      AND: [publicMarketplace(now), excludePreviewPackListingsWhere()],
    };
    expect(marketplaceListingWhere({ viewer: null, now })).toEqual(production);
    expect(marketplaceListingWhere({ viewer: { role: "USER" }, now })).toEqual(production);
    expect(marketplaceListingWhere({ viewer: { role: "DEALER" }, now })).toEqual(production);
    expect(marketplaceListingWhere({ viewer: { role: "ADMIN" }, now })).toEqual(production);
    expect(JSON.stringify(production)).toContain('"previewPackId":null');
  });

  it("adds enabled ADMIN_PREVIEW rows only for verified staging admins", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      env: verifiedStagingEnv,
    })).toEqual({
      OR: [
        publicMarketplace(now),
        { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
        linkedPreviewPackListingWhere(),
      ],
    });
    expect(marketplaceListingWhere({
      viewer: { role: "USER" },
      now,
      env: verifiedStagingEnv,
    })).toEqual(publicMarketplace(now));
  });

  it("never puts ADMIN_PREVIEW into the public sitemap query", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(liveListingWhere(now)).toEqual({
      status: "LIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
    expect(JSON.stringify(liveListingWhere(now))).not.toContain("ADMIN_PREVIEW");
  });

  it("hides disabled packs by default and includes them for staging admin browse surfaces", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      env: verifiedStagingEnv,
    })).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
        ]),
      }),
    );
    expect(marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      includeDisabledPreviewPacks: true,
      env: verifiedStagingEnv,
    })).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([{ status: "ADMIN_PREVIEW" }]),
      }),
    );
    expect(marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      includeDisabledPreviewPacks: true,
    })).toEqual(marketplaceListingWhere({ viewer: null, now }));
  });

  it("hides seed private listings on staging without removing preview-pack rows from the admin branch", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const where = marketplaceListingWhere({
      viewer: { role: "ADMIN" },
      now,
      sampleVisibility: { privateListings: false, dealerListings: true },
      env: verifiedStagingEnv,
    });
    expect(where).toEqual({
      AND: [
        {
          OR: [
            publicMarketplace(now),
            { status: "ADMIN_PREVIEW", previewPack: { enabled: true } },
            linkedPreviewPackListingWhere(),
          ],
        },
        { NOT: samplePrivateListingWhere() },
      ],
    });
  });

  it("hides seed dealer listings and preview-pack rows from production public queries", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const sample = { privateListings: true, dealerListings: false };
    const where = marketplaceListingWhere({
      viewer: null,
      now,
      sampleVisibility: sample,
    });
    expect(where).toEqual({
      AND: [
        publicMarketplace(now, sample),
        { NOT: sampleDealerListingWhere() },
        excludePreviewPackListingsWhere(),
      ],
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
