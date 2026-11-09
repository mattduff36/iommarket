import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dealerFindFirstMock, settingsFindManyMock, imageFindUniqueMock } = vi.hoisted(() => ({
  dealerFindFirstMock: vi.fn(),
  settingsFindManyMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db", () => ({
  db: {
    siteSetting: { findMany: settingsFindManyMock },
    listingImage: { findUnique: imageFindUniqueMock },
    dealerProfile: {
      findFirst: dealerFindFirstMock,
    },
  },
}));

import {
  hasPublicListingSellerAccess,
  publicListingSellerWhere,
} from "@/lib/listings/dealer-visibility";
import { loadAuthorizedListingPhoto } from "@/lib/media/authorize-listing-photo";
import { SETTING_KEYS } from "@/lib/config/site-settings";
import { DATABASE_SYNC_VISIBILITY_KEY } from "@/lib/database-sync/visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

describe("public listing seller visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsFindManyMock.mockReset().mockResolvedValue([]);
  });

  it("reuses supplied sample visibility for dealer entitlement without reading settings", async () => {
    dealerFindFirstMock.mockResolvedValue({ id: "dealer-1" });
    const sampleVisibility = { privateListings: true, dealerListings: false, archivedDealerIds: ["archived"], visibleDealerIds: ["copied"] };
    await expect(hasPublicListingSellerAccess("dealer-1", false, false, sampleVisibility)).resolves.toBe(true);
    expect(settingsFindManyMock).not.toHaveBeenCalled();
    const serialized = JSON.stringify(dealerFindFirstMock.mock.calls[0][0].where);
    expect(serialized).toContain("archived");
    expect(serialized).toContain("copied");
    expect(serialized).toContain("subscriptions");
    expect(serialized).toContain('"disabledAt":null');
  });

  it("requires every listing owner to be enabled and undeleted", () => {
    const where = publicListingSellerWhere(
      new Date("2026-10-02T10:00:00.000Z"),
    );

    expect(where).toMatchObject({
      user: {
        disabledAt: null,
        deletedAt: null,
      },
      OR: [
        { dealerId: null },
        { dealer: { is: expect.any(Object) } },
      ],
    });
    expect(JSON.stringify(where)).toContain('"isAdminPreview":false');
  });

  it("hides disabled private and dealer listings and restores access when enabled", async () => {
    dealerFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "dealer-enabled" });

    await expect(
      hasPublicListingSellerAccess(null, true, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess(null, false, false),
    ).resolves.toBe(true);
    await expect(
      hasPublicListingSellerAccess("dealer-disabled", true, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess("dealer-expired", false, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess("dealer-enabled", false, false),
    ).resolves.toBe(true);

    expect(dealerFindFirstMock).toHaveBeenCalledTimes(2);
    const lookup = dealerFindFirstMock.mock.calls[1][0] as {
      where: { AND: Array<{ id?: string }> };
      select: { id: boolean };
    };
    expect(lookup.select).toEqual({ id: true });
    expect(lookup.where.AND[0]).toEqual({ id: "dealer-enabled" });
    const serialized = JSON.stringify(lookup.where);
    expect(serialized).toContain('"isAdminPreview":false');
    expect(serialized).toContain("preview-system:");
    expect(serialized).toContain("DEALER");
  });
});

describe("listing photo sample visibility reuse", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  beforeEach(() => {
    vi.clearAllMocks();
    settingsFindManyMock.mockReset().mockResolvedValue([]);
    dealerFindFirstMock.mockReset().mockResolvedValue({ id: "dealer-1" });
    imageFindUniqueMock.mockResolvedValue({
      id: "image-1",
      listing: {
        id: "listing-1", status: "LIVE", expiresAt: null, userId: "owner",
        dealerId: "dealer-1", previewPackId: null, previewPack: null,
        user: { authUserId: "00000000-0000-0000-0000-101", email: "seller@example.test", disabledAt: null, deletedAt: null },
        dealer: { isAdminPreview: false },
      },
    });
  });

  it.each([true, false])("uses one current settings read for dealer and photo checks when samples visible is %s", async visible => {
    settingsFindManyMock.mockResolvedValue([
      { key: SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE, value: visible },
    ]);
    const image = await loadAuthorizedListingPhoto("image-1");
    expect(image?.id ?? null).toBe(visible ? "image-1" : null);
    expect(settingsFindManyMock).toHaveBeenCalledTimes(1);
    expect(dealerFindFirstMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dealerFindFirstMock.mock.calls[0][0].where).includes('"startsWith":"00000000-0000-0000-0000-"')).toBe(!visible);
  });

  it("still denies a dealer without public entitlement", async () => {
    dealerFindFirstMock.mockResolvedValue(null);
    await expect(loadAuthorizedListingPhoto("image-1")).resolves.toBeNull();
    expect(settingsFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("shares the staging registry snapshot with dealer access and archived-photo denial", async () => {
    for (const [key, value] of Object.entries(verifiedStagingEnv)) vi.stubEnv(key, value);
    settingsFindManyMock.mockResolvedValue([
      { key: DATABASE_SYNC_VISIBILITY_KEY, value: {
        archivedListingIds: ["listing-1"], archivedDealerIds: ["archived-dealer"], visibleDealerIds: ["dealer-1"],
      } },
    ]);
    await expect(loadAuthorizedListingPhoto("image-1")).resolves.toBeNull();
    expect(settingsFindManyMock).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(dealerFindFirstMock.mock.calls[0][0].where);
    expect(serialized).toContain('"in":["dealer-1"]');
    expect(serialized).toContain('"in":["archived-dealer"]');
    expect(serialized).toContain("subscriptions");
  });

  it("propagates a failed visibility read instead of authorizing the photo", async () => {
    settingsFindManyMock.mockRejectedValue(new Error("settings unavailable"));
    await expect(loadAuthorizedListingPhoto("image-1")).rejects.toThrow("settings unavailable");
  });
});
