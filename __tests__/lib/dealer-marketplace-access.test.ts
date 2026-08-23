import { describe, expect, it } from "vitest";
import {
  canViewMarketplaceDealerProfile,
  getMarketplaceDealerWhere,
  getPublicDealerWhere,
} from "@/lib/dealers/access";

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
        { isAdminPreview: true, previewPack: { enabled: true } },
      ],
    });
  });

  it("404s disabled preview dealer pages even for admins", () => {
    expect(
      canViewMarketplaceDealerProfile({
        viewer: { role: "ADMIN" },
        isAdminPreview: true,
        previewPackEnabled: false,
        hasEntitlement: false,
      }),
    ).toBe(false);
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
});
