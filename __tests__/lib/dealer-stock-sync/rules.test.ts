import { describe, expect, it } from "vitest";
import { scrapeFailureReason } from "@/lib/dealer-stock-sync/completeness";
import { isEligibleDealer } from "@/lib/dealer-stock-sync/eligibility";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import { chooseLeasableJob, LEASE_JOB_SQL } from "@/lib/dealer-stock-sync/lease";
import { buildStockSyncPlan } from "@/lib/dealer-stock-sync/plan";
import { foundingManagedSlug } from "@/lib/dealer-stock-sync/legacy-identity";
import { isFridaySixLondon, londonWeekKey } from "@/lib/dealer-stock-sync/schedule";
import { assertWorkerEnabled } from "@/lib/dealer-stock-sync/worker-guard";
import type { InventoryVehicle, SyncIdentity, SyncListing } from "@/lib/dealer-stock-sync/types";

function listing(overrides: Partial<SyncListing> = {}): SyncListing {
  return {
    id: "listing-1",
    status: "LIVE",
    price: 1_000_000,
    mileage: 10_000,
    featured: false,
    expiresAt: "2026-12-01T00:00:00.000Z",
    soldAt: null,
    lifecycleRevision: 3,
    photoRevision: 2,
    reviewSourceIdentity: "sourceVehicleId:1",
    slug: null,
    previewPackId: null,
    openRevision: false,
    ...overrides,
  };
}

function identity(overrides: Partial<SyncIdentity> = {}): SyncIdentity {
  return {
    sourceIdentityKey: "sourceVehicleId:1",
    listingId: "listing-1",
    absenceCount: 0,
    lastAbsenceRunId: null,
    lastSeenRunId: "previous",
    baselinePricePence: 1_000_000,
    baselineMileage: 10_000,
    ...overrides,
  };
}

function vehicle(overrides: Partial<InventoryVehicle> = {}): InventoryVehicle {
  return {
    sourceIdentityKey: "sourceVehicleId:1",
    availability: "available",
    isPoa: false,
    pricePence: 1_000_000,
    mileage: 10_000,
    importable: true,
    skipReason: null,
    title: "2019 Mercedes A Class",
    description: "A complete description used only when creating a new listing.",
    categorySlug: "car",
    attributes: { make: "Mercedes" },
    ownedImages: [],
    remoteImageCount: 2,
    ...overrides,
  };
}

function plan(overrides: Partial<Parameters<typeof buildStockSyncPlan>[0]> = {}) {
  return buildStockSyncPlan({
    scrapeRunId: "run-1",
    registryKey: "franklins",
    regionId: "region-1",
    vehicles: [],
    identities: [identity()],
    listings: [listing()],
    ...overrides,
  });
}

describe("dealer stock sync rules", () => {
  it("freezes source photos for approval and holds unmatched existing stock", () => {
    const sourceImageUrls = ["https://dealer.example/vehicle.jpg"];
    const next = vehicle({ sourceIdentityKey: "sourceVehicleId:2", sourceImageUrls });
    const ready = plan({ vehicles: [next], listings: [], identities: [] });
    expect(ready.actions[0]).toMatchObject({ kind: "create", sourceImageUrls, ownedImages: [] });
    const unmatched = plan({ vehicles: [next], listings: [listing({ reviewSourceIdentity: null })], identities: [] });
    expect(unmatched.actions[0]).toMatchObject({ kind: "blocked", reason: "unmapped-existing-stock" });
  });

  it("does not change prices from invalid source records", () => {
    const result = plan({ vehicles: [vehicle({ importable: false, skipReason: "invalid-price", pricePence: -1 })] });
    expect(result.actions[0]).toMatchObject({ kind: "blocked", reason: "invalid-price" });
    expect(result.patches[0]?.absenceCount).toBe(0);
  });

  it("enqueues only at Friday 06:00 London for both BST and GMT", () => {
    expect(isFridaySixLondon(new Date("2026-06-19T05:00:00.000Z"))).toBe(true);
    expect(isFridaySixLondon(new Date("2026-06-19T06:00:00.000Z"))).toBe(false);
    expect(isFridaySixLondon(new Date("2026-01-16T06:00:00.000Z"))).toBe(true);
    expect(isFridaySixLondon(new Date("2026-01-16T05:00:00.000Z"))).toBe(false);
    expect(londonWeekKey(new Date("2026-06-19T05:00:00.000Z"))).toBe(
      londonWeekKey(new Date("2026-06-19T06:00:00.000Z")),
    );
  });

  it("fails closed for zero, partial, failed, detail, and pagination uncertainty", () => {
    expect(scrapeFailureReason([{ status: "ok", vehicleCount: 0, advertisedCount: null, pagesFetched: 1, detailMissing: 0, paginationUncertain: false }])).toBe("zero-inventory");
    expect(scrapeFailureReason([{ status: "ok", vehicleCount: 2, advertisedCount: 5, pagesFetched: 1, detailMissing: 0, paginationUncertain: false }])).toBe("partial-inventory");
    expect(scrapeFailureReason([{ status: "failed", vehicleCount: 2, advertisedCount: null, pagesFetched: 1, detailMissing: 0, paginationUncertain: false }])).toBe("source-failed");
    expect(scrapeFailureReason([{ status: "ok", vehicleCount: 2, advertisedCount: null, pagesFetched: 1, detailMissing: 1, paginationUncertain: false }])).toBe("detail-uncertain");
    expect(scrapeFailureReason([{ status: "ok", vehicleCount: 2, advertisedCount: null, pagesFetched: 1, detailMissing: 0, paginationUncertain: true }])).toBe("pagination-uncertain");
  });

  it("proposes unpublish only on the second confirmed absence and ignores a retry of the same run", () => {
    const once = plan();
    expect(once.actions.some((action) => action.kind === "missing_once")).toBe(true);
    expect(once.patches[0]?.absenceCount).toBe(1);
    const retried = plan({
      identities: [identity({ absenceCount: 1, lastAbsenceRunId: "run-1" })],
    });
    expect(retried.patches[0]?.absenceCount).toBe(1);
    const twice = plan({ identities: [identity({ absenceCount: 1, lastAbsenceRunId: "run-0" })] });
    expect(twice.actions.some((action) => action.kind === "unpublish")).toBe(true);
  });

  it("resets absence when the vehicle reappears and preserves sold, revisions, edits, and features", () => {
    const back = plan({ vehicles: [vehicle()] });
    expect(back.patches[0]?.absenceCount).toBe(0);
    expect(back.actions.some((action) => action.kind === "unpublish")).toBe(false);

    const sold = plan({ listings: [listing({ status: "SOLD", soldAt: "2026-01-01T00:00:00.000Z" })] });
    expect(sold.actions).toContainEqual(expect.objectContaining({ kind: "blocked", reason: "sold-preserved" }));

    const revision = plan({
      vehicles: [vehicle({ pricePence: 900_000 })],
      listings: [listing({ openRevision: true })],
    });
    expect(revision.actions).toContainEqual(expect.objectContaining({ reason: "pending-revision" }));

    const edited = plan({ vehicles: [vehicle({ pricePence: 900_000 })], listings: [listing({ price: 800_000 })] });
    expect(edited.actions).toContainEqual(expect.objectContaining({ kind: "conflict", reason: "dealer-edited" }));

    const featured = plan({
      identities: [identity({ absenceCount: 1, lastAbsenceRunId: "run-0" })],
      listings: [listing({ featured: true })],
    });
    expect(featured.actions).toContainEqual(expect.objectContaining({ reason: "paid-feature" }));
  });

  it("records a field change only against the imported baseline and blocks a missing baseline", () => {
    const changed = plan({ vehicles: [vehicle({ pricePence: 900_000, mileage: 11_000 })] });
    const update = changed.actions.find((action) => action.kind === "update");
    expect(update && update.kind === "update" ? update.changes : []).toEqual([
      { field: "price", before: 1_000_000, after: 900_000 },
      { field: "mileage", before: 10_000, after: 11_000 },
    ]);
    const missingBaseline = plan({
      vehicles: [vehicle({ pricePence: 900_000 })],
      identities: [identity({ baselinePricePence: null, baselineMileage: null })],
    });
    expect(missingBaseline.actions).toContainEqual(expect.objectContaining({ reason: "absent-baseline" }));
    expect(missingBaseline.patches[0]?.baselinePricePence).toBe(1_000_000);
  });

  it("does not create a second listing for a legacy managed slug or a composite identity", () => {
    const key = "sourceVehicleId:99";
    const legacy = plan({
      vehicles: [vehicle({ sourceIdentityKey: key })],
      identities: [],
      listings: [listing({ id: "legacy", reviewSourceIdentity: null, slug: foundingManagedSlug("franklins", key) })],
    });
    expect(legacy.actions.some((action) => action.kind === "create")).toBe(false);
    expect(legacy.patches[0]?.listingId).toBe("legacy");

    const composite = plan({
      vehicles: [vehicle({ sourceIdentityKey: null })],
      identities: [],
      listings: [],
    });
    expect(composite.actions).toContainEqual(expect.objectContaining({ reason: "unstable-identity" }));
    expect(composite.patches).toHaveLength(0);
  });

  it("treats duplicate source rows as blocked and keeps reserved cars in the present set", () => {
    const duplicates = plan({
      vehicles: [vehicle(), vehicle()],
      identities: [],
      listings: [],
    });
    expect(duplicates.actions).toContainEqual(expect.objectContaining({ reason: "duplicate-source" }));
    const reserved = plan({
      vehicles: [vehicle({ availability: "reserved", isPoa: false, pricePence: null, importable: false, skipReason: "reserved" })],
    });
    expect(reserved.actions.some((action) => action.kind === "unchanged" || action.kind === "conflict")).toBe(true);
    expect(reserved.patches[0]?.absenceCount).toBe(0);
  });

  it("refuses a second lease while one is active and reclaims an expired lease", () => {
    const now = new Date("2026-06-19T05:00:00.000Z");
    const queued = { id: "queued", bindingId: "binding", status: "QUEUED" as const, leaseExpiresAt: null, createdAt: "2026-06-19T04:00:00.000Z" };
    const active = { id: "active", bindingId: "binding", status: "LEASED" as const, leaseExpiresAt: "2026-06-19T05:10:00.000Z", createdAt: "2026-06-19T03:00:00.000Z" };
    expect(chooseLeasableJob([queued, active], now)).toBeNull();
    expect(chooseLeasableJob([{ ...active, leaseExpiresAt: "2026-06-19T04:00:00.000Z" }], now)?.id).toBe("active");
    expect(LEASE_JOB_SQL).toContain("FOR UPDATE OF binding, candidate SKIP LOCKED");
  });

  it("changes the fingerprint when a dealer edits the listing", () => {
    const base = {
      dealer: {
        id: "dealer",
        userId: "user",
        regionId: "region",
        tier: "PRO",
        isAdminPreview: false,
        role: "DEALER",
        disabledAt: null,
        deletedAt: null,
      },
      binding: { id: "binding", registryKey: "franklins", enabled: true, verifiedAt: "2026-06-01T00:00:00.000Z" },
      activeListingCount: 1,
      listingCap: 100,
      listings: [listing()],
      identities: [identity()],
      actions: plan({ vehicles: [vehicle({ pricePence: 900_000 })] }).actions,
    } satisfies FingerprintSnapshot;
    const edited = { ...base, listings: [listing({ price: 800_000 })] };
    expect(fingerprintSnapshot(base)).not.toBe(fingerprintSnapshot(edited));
  });

  it("excludes preview, disabled, deleted, and non-dealer accounts", () => {
    expect(isEligibleDealer({ isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null })).toBe(true);
    expect(isEligibleDealer({ isAdminPreview: true, role: "DEALER", disabledAt: null, deletedAt: null })).toBe(false);
    expect(isEligibleDealer({ isAdminPreview: false, role: "ADMIN", disabledAt: null, deletedAt: null })).toBe(false);
    expect(isEligibleDealer({ isAdminPreview: false, role: "DEALER", disabledAt: "2026-01-01", deletedAt: null })).toBe(false);
    expect(isEligibleDealer({ isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: "2026-01-01" })).toBe(false);
  });

  it("requires worker opt-in and a verified environment; production defaults off", () => {
    expect(() => assertWorkerEnabled({})).toThrow(/DEALER_STOCK_SYNC_WORKER/);
    expect(() =>
      assertWorkerEnabled({
        DEALER_STOCK_SYNC_WORKER: "1",
        DEALER_STOCK_SYNC_TARGET: "production",
        DATABASE_URL: "postgres://example.test/db",
      }),
    ).toThrow(/disabled in production/);
    expect(() =>
      assertWorkerEnabled({
        DEALER_STOCK_SYNC_WORKER: "1",
        DEALER_STOCK_SYNC_TARGET: "preview",
        DATABASE_URL: "postgres://example.test/snlqivvogfqesxpbjiei",
      }),
    ).toThrow(/authentication environment/);
  });
});
