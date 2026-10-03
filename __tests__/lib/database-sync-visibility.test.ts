import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabaseSyncVisibility, parseDatabaseSyncVisibility } from "@/lib/database-sync/visibility";
import { applySampleListingVisibility, getSampleVisibility, isHiddenSampleDealer, isHiddenSampleListing } from "@/lib/listings/sample-visibility";
import { canViewMarketplaceDealerProfile, getMarketplaceDealerWhere, getPublicDealerWhere } from "@/lib/dealers/access";
const mock = vi.hoisted(() => ({ getSetting: vi.fn(), getBoolSetting: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/config/site-settings", () => ({ ...mock, SETTING_KEYS: { SAMPLE_PRIVATE_LISTINGS_VISIBLE: "private", SAMPLE_DEALER_LISTINGS_VISIBLE: "dealer" } }));
const registry = { archivedListingIds: ["old-listing"], archivedDealerIds: ["old-dealer"], visibleDealerIds: ["copied-dealer"] };
const sample = { privateListings: true, dealerListings: true, ...registry };
function staging() {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", "staging");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.itrader.im"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://syneonzucehwlghqmfbg.supabase.co");
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "postgres://postgres@db.syneonzucehwlghqmfbg.supabase.co/postgres");
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("staging archive visibility", () => {
  it("ignores the registry on production without reading it", async () => {
    staging(); vi.stubEnv("VERCEL_ENV", "production"); mock.getSetting.mockRejectedValue(new Error("must not read"));
    expect(await getDatabaseSyncVisibility()).toBeUndefined();
    expect(mock.getSetting).not.toHaveBeenCalled();
    expect(await getSampleVisibility()).toEqual({ privateListings: true, dealerListings: true });
  });
  it("loads and validates the registry only on the verified staging target", async () => {
    staging(); mock.getSetting.mockResolvedValue(registry);
    expect(await getSampleVisibility()).toEqual(sample);
    mock.getSetting.mockResolvedValue({ ...registry, archivedListingIds: "invalid" });
    await expect(getSampleVisibility()).rejects.toThrow("registry is invalid");
  });
  it("rejects unknown fields, malformed ids and oversized lists", () => {
    for (const value of [null, { ...registry, privileged: true }, { ...registry, archivedDealerIds: [""] }, { ...registry, visibleDealerIds: Array(50_001).fill("dealer") }]) {
      expect(() => parseDatabaseSyncVisibility(value)).toThrow("registry is invalid");
    }
  });
  it("excludes archived listings and dealers outside all ordinary and administrator query branches", () => {
    expect(applySampleListingVisibility({ status: "LIVE" }, sample)).toEqual({ AND: [
      { status: "LIVE" }, { NOT: { id: { in: ["old-listing"] } } }, { NOT: { dealerId: { in: ["old-dealer"] } } },
    ] });
    expect(getMarketplaceDealerWhere({ role: "ADMIN" }, new Date(), sample)).toMatchObject({ AND: [
      { OR: expect.any(Array) }, { id: { notIn: ["old-dealer"] } },
    ] });
    expect(isHiddenSampleListing({ listingId: "old-listing", authUserId: "actual-login", dealerId: null, isAdminPreview: false, sampleVisibility: sample })).toBe(true);
    expect(isHiddenSampleListing({ listingId: "other", authUserId: "actual-login", dealerId: "old-dealer", isAdminPreview: false, sampleVisibility: sample })).toBe(true);
    expect(isHiddenSampleDealer({ dealerId: "old-dealer", authUserId: "actual-login", isAdminPreview: true, sampleVisibility: sample })).toBe(true);
  });
  it("allows copied dealer appearance while retaining active-owner checks and no payment entitlement", () => {
    expect(getPublicDealerWhere(new Date(), sample)).toMatchObject({ AND: [
      { OR: [expect.objectContaining({ subscriptions: expect.any(Object) }), { id: { in: ["copied-dealer"] } }], user: { disabledAt: null, deletedAt: null } },
      { NOT: { id: { in: ["old-dealer"] } } },
    ] });
    const input = { viewer: { role: "USER" }, isAdminPreview: false, previewPackEnabled: false, hasEntitlement: false };
    expect(canViewMarketplaceDealerProfile(input)).toBe(false);
    expect(canViewMarketplaceDealerProfile({ ...input, visibleInStagingSnapshot: true })).toBe(true);
  });
});
