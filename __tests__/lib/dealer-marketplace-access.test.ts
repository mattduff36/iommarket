import { describe, expect, it, vi } from "vitest";
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

  it("T12 T13 lets admins view unpaid non-preview profiles without changing directory filters", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now)).toEqual({
      OR: [
        getPublicDealerWhere(now),
        { isAdminPreview: true, previewPack: { enabled: true } },
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
});

describe("ensureAdminDealerProfile", () => {
  it("T9 provisions a missing admin dealer profile via upsert", async () => {
    const { ensureAdminDealerProfile } = await import("@/lib/dealers/access");
    const upsert = vi.fn().mockResolvedValue({
      id: "dealer-admin",
      slug: "dealer-admin-1",
    });
    const user = {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      role: "ADMIN" as const,
      dealerProfile: null,
    };

    const provisioned = await ensureAdminDealerProfile(user, {
      dealerProfile: { upsert },
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "admin-1" },
      }),
    );
    expect(provisioned.dealerProfile).toEqual({
      id: "dealer-admin",
      slug: "dealer-admin-1",
    });
  });
});
