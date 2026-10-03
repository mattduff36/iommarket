import { describe, expect, it } from "vitest";
import {
  canViewMarketplaceDealerProfile,
  getMarketplaceDealerWhere,
  getPublicDealerWhere,
} from "@/lib/dealers/access";
import { sampleDealerProfileWhere } from "@/lib/listings/sample-visibility";

describe("marketplace dealer access", () => {
  it("keeps preview dealers off the public directory", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere(null, now)).toEqual(getPublicDealerWhere(now));
    expect(getMarketplaceDealerWhere({ role: "DEALER" }, now)).toEqual(
      getPublicDealerWhere(now),
    );
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now)).toEqual({
      OR: [
        getPublicDealerWhere(now),
        { isAdminPreview: true },
      ],
    });
  });

  it("lets admins view disabled preview dealer pages without opening them to the public", () => {
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "ADMIN" },
        isAdminPreview: true,
        previewPackEnabled: false,
        hasEntitlement: false,
      }),
    ).toBe(true);
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "ADMIN" },
        isAdminPreview: true,
        previewPackEnabled: true,
        hasEntitlement: false,
      }),
    ).toBe(true);
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "USER" },
        isAdminPreview: true,
        previewPackEnabled: true,
        hasEntitlement: false,
      }),
    ).toBe(false);
  });

  it("T12 T13 lets admins view unpaid non-preview profiles without changing directory filters", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now)).toEqual({
      OR: [
        getPublicDealerWhere(now),
        { isAdminPreview: true },
      ],
    });
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "ADMIN" },
        isAdminPreview: false,
        previewPackEnabled: false,
        hasEntitlement: false,
      }),
    ).toBe(true);
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "USER" },
        isAdminPreview: false,
        previewPackEnabled: false,
        hasEntitlement: false,
      }),
    ).toBe(false);
  });

  it("hides seed dealers when sample dealer listings are off and keeps preview packs", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const hidden = { privateListings: true, dealerListings: false };
    expect(getPublicDealerWhere(now, hidden)).toEqual({
      AND: [getPublicDealerWhere(now), { NOT: sampleDealerProfileWhere() }],
    });
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now, hidden)).toEqual({
      OR: [
        getPublicDealerWhere(now, hidden),
        { isAdminPreview: true },
      ],
    });
  });
});

describe("getAdminDealerWhere", () => {
  it("lists dealer accounts and leaves admin accounts out", async () => {
    const { getAdminDealerWhere } = await import("@/lib/dealers/access");

    expect(getAdminDealerWhere()).toEqual({
      isAdminPreview: false,
      user: { role: "DEALER" },
    });
  });
});
