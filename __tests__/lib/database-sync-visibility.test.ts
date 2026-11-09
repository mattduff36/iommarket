import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_SYNC_VISIBILITY_KEY, getDatabaseSyncVisibility, parseDatabaseSyncVisibility } from "@/lib/database-sync/visibility";
import { applySampleListingVisibility, getSampleVisibility, isHiddenSampleDealer, isHiddenSampleListing } from "@/lib/listings/sample-visibility";
import { canViewMarketplaceDealerProfile, getMarketplaceDealerWhere, getPublicDealerWhere } from "@/lib/dealers/access";
import { excludePreviewPackDealersWhere, excludePreviewPackListingsWhere } from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";
import { SETTING_KEYS } from "@/lib/config/site-settings";
const mock = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { siteSetting: { findMany: mock.findMany } } }));
const registry = { archivedListingIds: ["old-listing"], archivedDealerIds: ["old-dealer"], visibleDealerIds: ["copied-dealer"] };
const sample = { privateListings: true, dealerListings: true, ...registry };
function staging() {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", "staging");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.dev"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://syneonzucehwlghqmfbg.supabase.co");
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "postgres://postgres@db.syneonzucehwlghqmfbg.supabase.co/postgres");
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
beforeEach(() => { mock.findMany.mockReset().mockResolvedValue([]); });
describe("staging archive visibility", () => {
  it("ignores the registry on production without reading it", async () => {
    staging(); vi.stubEnv("VERCEL_ENV", "production");
    mock.findMany.mockResolvedValue([{ key: DATABASE_SYNC_VISIBILITY_KEY, value: { invalid: true } }]);
    expect(await getDatabaseSyncVisibility()).toBeUndefined();
    expect(await getDatabaseSyncVisibility(new Map([[DATABASE_SYNC_VISIBILITY_KEY, { invalid: true }]]))).toBeUndefined();
    expect(mock.findMany).not.toHaveBeenCalled();
    expect(await getSampleVisibility()).toEqual({ privateListings: true, dealerListings: true });
    expect(mock.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { key: { in: [SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE, SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE] } },
      select: { key: true, value: true },
    });
  });
  it("keeps standalone registry reads targeted and defaults a null registry to empty", async () => {
    staging();
    mock.findMany.mockResolvedValue([{ key: DATABASE_SYNC_VISIBILITY_KEY, value: null }]);
    expect(await getDatabaseSyncVisibility()).toEqual({ archivedListingIds: [], archivedDealerIds: [], visibleDealerIds: [] });
    expect(mock.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { key: { in: [DATABASE_SYNC_VISIBILITY_KEY] } },
      select: { key: true, value: true },
    });
  });
  it("loads and validates the registry only on the verified staging target", async () => {
    staging(); mock.findMany.mockResolvedValue([{ key: DATABASE_SYNC_VISIBILITY_KEY, value: registry }]);
    expect(await getSampleVisibility()).toEqual(sample);
    expect(mock.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { key: { in: [
        SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE,
        SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE,
        DATABASE_SYNC_VISIBILITY_KEY,
      ] } },
      select: { key: true, value: true },
    });
    mock.findMany.mockResolvedValue([{ key: DATABASE_SYNC_VISIBILITY_KEY, value: { ...registry, archivedListingIds: "invalid" } }]);
    await expect(getSampleVisibility()).rejects.toThrow("registry is invalid");
  });
  it("reads fresh booleans each time and preserves defaults for missing, null and non-boolean settings", async () => {
    staging();
    mock.findMany.mockResolvedValueOnce([
      { key: SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE, value: false },
      { key: SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE, value: false },
    ]).mockResolvedValueOnce([
      { key: SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE, value: null },
      { key: SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE, value: "false" },
    ]);
    expect(await getSampleVisibility()).toEqual({ privateListings: false, dealerListings: false, archivedListingIds: [], archivedDealerIds: [], visibleDealerIds: [] });
    expect(await getSampleVisibility()).toEqual({ privateListings: true, dealerListings: true, archivedListingIds: [], archivedDealerIds: [], visibleDealerIds: [] });
    expect(mock.findMany).toHaveBeenCalledTimes(2);
  });
  it("never selects or parses the registry against an unverified database", async () => {
    staging(); vi.stubEnv("DATABASE_URL", "postgres://postgres@db.unverified.supabase.co/postgres");
    mock.findMany.mockResolvedValue([{ key: DATABASE_SYNC_VISIBILITY_KEY, value: { invalid: true } }]);
    expect(await getSampleVisibility()).toEqual({ privateListings: true, dealerListings: true });
    expect(mock.findMany.mock.calls[0][0].where.key.in).not.toContain(DATABASE_SYNC_VISIBILITY_KEY);
  });
  it("propagates settings read failures without falling back to visible samples", async () => {
    mock.findMany.mockRejectedValue(new Error("settings unavailable"));
    await expect(getSampleVisibility()).rejects.toThrow("settings unavailable");
    expect(mock.findMany).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown fields, malformed ids and oversized lists", () => {
    for (const value of [null, { ...registry, privileged: true }, { ...registry, archivedDealerIds: [""] }, { ...registry, visibleDealerIds: Array(50_001).fill("dealer") }]) {
      expect(() => parseDatabaseSyncVisibility(value)).toThrow("registry is invalid");
    }
  });
  it("excludes archived listings and dealers outside all ordinary and administrator query branches", () => {
    expect(applySampleListingVisibility({ status: "LIVE" }, sample)).toEqual({ AND: [
      { status: "LIVE" }, { NOT: { id: { in: ["old-listing"] } } }, { NOT: { dealerId: { in: ["old-dealer"] } } },
      excludePreviewPackListingsWhere(),
    ] });
    const now = new Date("2026-10-04T00:00:00.000Z");
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, now, sample)).toEqual(
      getPublicDealerWhere(now, sample),
    );
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, new Date(), sample, verifiedStagingEnv)).toMatchObject({ AND: [
      { OR: expect.any(Array) }, { id: { notIn: ["old-dealer"] } },
    ] });
    expect(isHiddenSampleListing({ listingId: "old-listing", authUserId: "actual-login", dealerId: null, isAdminPreview: false, sampleVisibility: sample })).toBe(true);
    expect(isHiddenSampleListing({ listingId: "other", authUserId: "actual-login", dealerId: "old-dealer", isAdminPreview: false, sampleVisibility: sample })).toBe(true);
    expect(isHiddenSampleDealer({ dealerId: "old-dealer", authUserId: "actual-login", isAdminPreview: true, sampleVisibility: sample })).toBe(true);
  });
  it("allows copied dealer appearance while retaining active-owner checks and no payment entitlement", () => {
    expect(getPublicDealerWhere(new Date(), sample)).toEqual({ AND: [
      expect.objectContaining({
        OR: [expect.objectContaining({ subscriptions: expect.any(Object) }), { id: { in: ["copied-dealer"] } }],
        user: expect.objectContaining({ disabledAt: null, deletedAt: null }),
        isAdminPreview: false,
      }),
      { NOT: { id: { in: ["old-dealer"] } } },
      excludePreviewPackDealersWhere(),
    ] });
    const input = { viewer: { role: "USER" }, isAdminPreview: false, previewPackEnabled: false, hasEntitlement: false };
    expect(canViewMarketplaceDealerProfile(input)).toBe(false);
    expect(canViewMarketplaceDealerProfile({ ...input, visibleInStagingSnapshot: true })).toBe(true);
  });
});
