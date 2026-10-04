import { describe, expect, it } from "vitest";
import {
  getDealerDirectoryQuery,
  getDealerSpotlightQuery,
  getMarketplaceDealerSpotlightQuery,
  sortDealersAlphabetically,
  shuffleDealerSpotlights,
} from "@/lib/dealers/spotlights";
import { excludePreviewPackDealersWhere } from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

describe("getDealerSpotlightQuery", () => {
  it("returns every eligible dealer without a spotlight cap", () => {
    const liveListingWhere = {
      status: "LIVE" as const,
      expiresAt: { gt: new Date("2026-07-20T00:00:00.000Z") },
    };

    const query = getDealerSpotlightQuery(liveListingWhere);

    expect(query.where).toEqual({
      AND: [
        expect.objectContaining({
          isAdminPreview: false,
          user: expect.objectContaining({
            role: { in: ["DEALER", "ADMIN"] },
            disabledAt: null,
            deletedAt: null,
          }),
        }),
        excludePreviewPackDealersWhere(),
      ],
      verified: true,
    });
    expect(query).toMatchObject({
      select: {
        id: true,
        name: true,
        slug: true,
        bio: true,
        logoUrl: true,
        verified: true,
        _count: {
          select: {
            listings: { where: liveListingWhere },
          },
        },
      },
    });
    expect(query).not.toHaveProperty("take");
    expect(query).not.toHaveProperty("skip");
  });
});

describe("getDealerDirectoryQuery", () => {
  it("includes every active subscribed dealer regardless of verification", () => {
    const query = getDealerDirectoryQuery({
      status: "LIVE",
    });

    expect(query.where).toEqual({
      AND: [
        expect.objectContaining({
          isAdminPreview: false,
          subscriptions: {
            some: {
              OR: [
                {
                  source: "PAYMENT",
                  status: "ACTIVE",
                  currentPeriodEnd: expect.any(Object),
                },
                {
                  source: "ADMIN_GRANT",
                  status: "ACTIVE",
                  revokedAt: null,
                  grantStartsAt: expect.any(Object),
                  grantEndsAt: expect.any(Object),
                },
              ],
            },
          },
          user: expect.objectContaining({
            role: { in: ["DEALER", "ADMIN"] },
            disabledAt: null,
            deletedAt: null,
          }),
        }),
        excludePreviewPackDealersWhere(),
      ],
    });
    expect(query).toMatchObject({
      select: {
        verified: true,
      },
    });
    expect(query.where).not.toHaveProperty("verified");
    expect(query).not.toHaveProperty("take");
    expect(query).not.toHaveProperty("skip");
  });
});

describe("getMarketplaceDealerSpotlightQuery", () => {
  it("keeps preview dealers off production homepages and shows enabled packs to staging admins", () => {
    const listings = { status: "LIVE" as const };
    const production = JSON.stringify(
      getMarketplaceDealerSpotlightQuery(listings, { role: "ADMIN" }).where,
    );
    expect(production).toContain('"isAdminPreview":false');
    expect(production).not.toContain('"isAdminPreview":true');
    const staging = getMarketplaceDealerSpotlightQuery(
      listings,
      { role: "ADMIN" },
      undefined,
      verifiedStagingEnv,
    );
    expect(staging.where).toMatchObject({
      OR: expect.arrayContaining([
        expect.objectContaining({
          isAdminPreview: true,
          previewPack: { enabled: true },
        }),
      ]),
    });
  });
});

describe("sortDealersAlphabetically", () => {
  it("sorts names case-insensitively with slug and id tie-breakers", () => {
    const dealers = [
      { id: "3", slug: "zeta-b", name: "zeta" },
      { id: "4", slug: "alpha", name: "Alpha" },
      { id: "2", slug: "zeta-a", name: "Zeta" },
      { id: "1", slug: "zeta-a", name: "ZETA" },
    ];

    expect(sortDealersAlphabetically(dealers).map(({ id }) => id)).toEqual([
      "4",
      "1",
      "2",
      "3",
    ]);
    expect(dealers.map(({ id }) => id)).toEqual(["3", "4", "2", "1"]);
  });
});

describe("shuffleDealerSpotlights", () => {
  const dealers = [
    { id: "dealer-a" },
    { id: "dealer-b" },
    { id: "dealer-c" },
  ];

  it("returns a non-mutating permutation without duplicates", () => {
    const originalIds = dealers.map(({ id }) => id);
    const shuffled = shuffleDealerSpotlights(dealers, () => 0);

    expect(shuffled).not.toBe(dealers);
    expect(shuffled.map(({ id }) => id).sort()).toEqual(originalIds.sort());
    expect(new Set(shuffled.map(({ id }) => id))).toHaveLength(dealers.length);
    expect(dealers.map(({ id }) => id)).toEqual(["dealer-a", "dealer-b", "dealer-c"]);
  });

  it("can place a dealer in every position with deterministic random values", () => {
    const positionFor = (randomValues: number[]) => {
      let index = 0;
      const shuffled = shuffleDealerSpotlights(dealers, () => randomValues[index++] ?? 0);
      return shuffled.findIndex(({ id }) => id === "dealer-a");
    };

    expect([
      positionFor([0.99, 0.99]),
      positionFor([0.5, 0]),
      positionFor([0, 0.99]),
    ]).toEqual([0, 1, 2]);
  });

  it("handles empty and single-dealer collections", () => {
    expect(shuffleDealerSpotlights([])).toEqual([]);

    const soloDealer = [{ id: "dealer-only" }];
    const shuffled = shuffleDealerSpotlights(soloDealer);

    expect(shuffled).toEqual(soloDealer);
    expect(shuffled).not.toBe(soloDealer);
  });
});
