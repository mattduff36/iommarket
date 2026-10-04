import { describe, expect, it } from "vitest";
import {
  canViewMarketplaceDealerProfile,
  getAdminDealerWhere,
  getMarketplaceDealerWhere,
  getPublicDealerWhere,
} from "@/lib/dealers/access";
import { previewPackDealerMatchWhere } from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

describe("marketplace dealer access", () => {
  it("keeps preview dealers off production directories for every viewer, including admins", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere(null, now)).toEqual(getPublicDealerWhere(now));
    expect(getMarketplaceDealerWhere({ role: "DEALER" }, now)).toEqual(getPublicDealerWhere(now));
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now)).toEqual(getPublicDealerWhere(now));
    const serialized = JSON.stringify(getPublicDealerWhere(now));
    expect(serialized).toContain('"isAdminPreview":false');
    expect(serialized).toContain("preview-system:");
  });

  it("lets verified staging admins browse preview dealers without opening them publicly", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now, undefined, verifiedStagingEnv)).toEqual({
      OR: [
        getPublicDealerWhere(now, undefined, verifiedStagingEnv),
        previewPackDealerMatchWhere(),
      ],
    });
    expect(getMarketplaceDealerWhere(null, now, undefined, verifiedStagingEnv)).toEqual(
      getPublicDealerWhere(now, undefined, verifiedStagingEnv),
    );
  });

  it("hides entitled preview dealers from production, including admins", () => {
    const preview = {
      isAdminPreview: true,
      previewPackEnabled: true,
      hasEntitlement: true,
      authUserId: "preview-system:athol-garage",
      email: "preview+athol-garage@preview.internal",
    };
    expect(canViewMarketplaceDealerProfile({
      ...preview,
      viewer: { role: "ADMIN" },
    })).toBe(false);
    expect(canViewMarketplaceDealerProfile({
      ...preview,
      viewer: null,
    })).toBe(false);
    expect(canViewMarketplaceDealerProfile({
      ...preview,
      isAdminPreview: false,
      viewer: { role: "ADMIN" },
    })).toBe(false);
    expect(canViewMarketplaceDealerProfile({
      ...preview,
      viewer: { role: "ADMIN" },
      env: verifiedStagingEnv,
    })).toBe(true);
    expect(canViewMarketplaceDealerProfile({
      ...preview,
      viewer: { role: "USER" },
      env: verifiedStagingEnv,
    })).toBe(false);
  });

  it("lets staging admins view disabled preview dealer pages without opening them to the public", () => {
    expect(canViewMarketplaceDealerProfile({
      viewer: { role: "ADMIN" },
      isAdminPreview: true,
      previewPackEnabled: false,
      hasEntitlement: false,
      env: verifiedStagingEnv,
    })).toBe(true);
    expect(canViewMarketplaceDealerProfile({
      viewer: { role: "USER" },
      isAdminPreview: true,
      previewPackEnabled: true,
      hasEntitlement: false,
      env: verifiedStagingEnv,
    })).toBe(false);
  });

  it("T12 T13 lets admins view unpaid non-preview profiles without changing directory filters", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now)).toEqual(getPublicDealerWhere(now));
    expect(canViewMarketplaceDealerProfile({
      viewer: { role: "ADMIN" },
      isAdminPreview: false,
      previewPackEnabled: false,
      hasEntitlement: false,
    })).toBe(true);
    expect(canViewMarketplaceDealerProfile({
      viewer: { role: "USER" },
      isAdminPreview: false,
      previewPackEnabled: false,
      hasEntitlement: false,
    })).toBe(false);
  });

  it("hides seed dealers when sample dealer listings are off and keeps production preview packs hidden", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const hidden = { privateListings: true, dealerListings: false };
    expect(JSON.stringify(getPublicDealerWhere(now, hidden))).toContain("00000000-0000-0000-0000-");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now, hidden)).toEqual(
      getPublicDealerWhere(now, hidden),
    );
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now, hidden, verifiedStagingEnv)).toEqual({
      OR: [
        getPublicDealerWhere(now, hidden, verifiedStagingEnv),
        previewPackDealerMatchWhere(),
      ],
    });
  });
});

describe("getAdminDealerWhere", () => {
  it("lists dealer accounts and leaves admin and preview accounts out", () => {
    expect(getAdminDealerWhere()).toEqual({
      isAdminPreview: false,
      user: {
        role: "DEALER",
        NOT: {
          OR: [
            { authUserId: { startsWith: "preview-system:" } },
            {
              email: {
                endsWith: "@preview.internal",
                mode: "insensitive",
              },
            },
          ],
        },
      },
    });
  });
});
