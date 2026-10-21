import { describe, expect, it } from "vitest";
import { fingerprintSnapshot } from "../../../lib/dealer-stock-sync/fingerprint";
import type { InventoryVehicle, SyncIdentity } from "../../../lib/dealer-stock-sync/types";
import {
  applyReviewedDealerSeed,
  identitiesAfterPatches,
  planReviewedAdditions,
  reviewedCapacityWarning,
  reviewedSeedApplyBlock,
  type ReviewedSeedRequest,
} from "../../../scripts/dealer-onboarding/seed-reviewed-stock-reports";
import type { ReviewedAdaptation } from "../../../scripts/dealer-stock-sync/reviewed-source";

const previewEnv = {
  DEALER_STOCK_SYNC_TARGET: "preview",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  POSTGRES_URL: "postgresql://postgres.syneonzucehwlghqmfbg:test@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
  POSTGRES_URL_NON_POOLING: "postgresql://postgres.syneonzucehwlghqmfbg:test@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
  DATABASE_URL: "postgresql://postgres.syneonzucehwlghqmfbg:test@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
};

const adaptation: ReviewedAdaptation = {
  vehicles: [],
  evidence: {},
  capturedAt: "2026-10-21T00:00:00.000Z",
  coverageWarning: "coverage warning",
  counts: { rows: 0, importable: 0, blocked: 0, sold: 0, correctedPrices: 0, reasons: {} },
};

function dealer() {
  return {
    id: "dealer-1",
    tier: "STARTER",
    isAdminPreview: false,
    userId: "user-1",
    user: { role: "DEALER" as const, disabledAt: null, deletedAt: null, regionId: "region-1" as string | null },
  };
}

function request(overrides: Partial<ReviewedSeedRequest> = {}): ReviewedSeedRequest {
  return {
    targetConfirmed: true,
    actorId: "admin-user-1",
    dealerId: "dealer-1",
    registryKey: "dw-cars",
    sourceHash: "c".repeat(64),
    adaptation,
    ...overrides,
  };
}

function fakeClient(state: {
  reports?: Array<{ id: string; plan: unknown }>;
  listings?: number;
  identities?: number;
  jobs?: number;
  applyJobs?: number;
  binding?: { id: string; dealerId: string; registryKey: string; enabled: boolean; verifiedAt: Date | null } | null;
  regionId?: string | null;
}) {
  const calls = { reports: 0, upserts: 0, jobs: [] as object[], binding: [] as object[], plan: null as unknown, transactions: 0 };
  const client: {
    user: { findUnique: () => Promise<{ id: string; role: string; disabledAt: null; deletedAt: null }> };
    dealerProfile: { findUnique: () => Promise<ReturnType<typeof dealer>> };
    listing: { count: () => Promise<number> };
    dealerStockSourceBinding: {
      findUnique: (args: { where: { dealerId?: string; registryKey?: string } }) => Promise<{ id: string; dealerId: string; registryKey: string; enabled: boolean; verifiedAt: Date | null } | null>;
      create: (args: { data: object }) => Promise<{ id: string; registryKey: string; enabled: boolean; verifiedAt: Date }>;
    };
    dealerStockSourceIdentity: { count: () => Promise<number>; upsert: () => Promise<{ id: string }> };
    dealerStockSyncJob: { count: (args: { where: { kind?: string } }) => Promise<number>; create: (args: { data: object }) => Promise<{ id: string }> };
    dealerStockSyncReport: {
      findMany: () => Promise<Array<{ id: string; plan: unknown }>>;
      updateMany: () => Promise<{ count: number }>;
      create: () => Promise<{ id: string; fingerprint: string }>;
      update: (args: { data: { plan: unknown } }) => Promise<unknown>;
    };
    dealerStockSyncAudit: { create: () => Promise<{ id: string }> };
    $transaction: (work: (tx: never) => Promise<unknown>) => Promise<unknown>;
  } = {
    user: { findUnique: async () => ({ id: "admin-user-1", role: "ADMIN", disabledAt: null, deletedAt: null }) },
    dealerProfile: { findUnique: async () => ({ ...dealer(), user: { ...dealer().user, regionId: state.regionId === undefined ? "region-1" : state.regionId } }) },
    listing: { count: async () => state.listings ?? 0 },
    dealerStockSourceBinding: {
      findUnique: async (args: { where: { dealerId?: string; registryKey?: string } }) => args.where.registryKey ? null : state.binding ?? null,
      create: async (args: { data: object }) => {
        calls.binding.push(args.data);
        return { id: "binding-1", registryKey: "dw-cars", enabled: false, verifiedAt: new Date() };
      },
    },
    dealerStockSourceIdentity: {
      count: async () => state.identities ?? 0,
      upsert: async () => { calls.upserts += 1; return { id: "identity-1" }; },
    },
    dealerStockSyncJob: {
      count: async (args: { where: { kind?: string } }) => args.where.kind === "APPLY" ? state.applyJobs ?? 0 : state.jobs ?? 0,
      create: async (args: { data: object }) => { calls.jobs.push(args.data); return { id: "job-1" }; },
    },
    dealerStockSyncReport: {
      findMany: async () => state.reports ?? [],
      updateMany: async () => ({ count: 0 }),
      create: async () => { calls.reports += 1; return { id: "report-new", fingerprint: "f".repeat(64) }; },
      update: async (args: { data: { plan: unknown } }) => { calls.plan = args.data.plan; return {}; },
    },
    dealerStockSyncAudit: { create: async () => ({ id: "audit-1" }) },
    $transaction: async (work) => {
      calls.transactions += 1;
      return work(client as never);
    },
  };
  return { client, calls };
}

describe("reviewed stock seed guards", () => {
  it("allows only an explicit verified preview target", () => {
    expect(reviewedSeedApplyBlock(previewEnv)).toBeNull();
    expect(reviewedSeedApplyBlock({ ...previewEnv, DEALER_STOCK_SYNC_TARGET: "production", VERCEL_ENV: "production" })).toMatch(/production/i);
    expect(reviewedSeedApplyBlock({
      ...previewEnv,
      DATABASE_URL: "postgresql://postgres.snlqivvogfqesxpbjiei:test@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres",
    })).toMatch(/production/i);
    expect(reviewedSeedApplyBlock({ ...previewEnv, DEALER_STOCK_SYNC_TARGET: undefined, NEXT_PUBLIC_APP_URL: "https://itrader.im" })).toMatch(/preview|production|verified/i);
  });

  it("returns the same pending review without writes and rejects a conflicting snapshot", async () => {
    const same = fakeClient({ reports: [{ id: "report-1", plan: { reviewSource: { sourceHash: "c".repeat(64) } } }] });
    const existing = await applyReviewedDealerSeed(same.client as never, request());
    expect(existing).toMatchObject({ outcome: "existing", reportId: "report-1", wrote: false });
    expect(same.calls.transactions).toBe(1);
    expect(same.calls.reports).toBe(0);
    expect(same.calls.jobs).toHaveLength(0);
    const conflict = fakeClient({ reports: [{ id: "report-2", plan: { reviewSource: { sourceHash: "d".repeat(64) } } }] });
    await expect(applyReviewedDealerSeed(conflict.client as never, request())).rejects.toThrow(/different source snapshot/);
    expect(conflict.calls.reports).toBe(0);
  });

  it("refuses listings, identities, and apply jobs, and stores a disabled binding", async () => {
    const listings = fakeClient({ listings: 1 });
    await expect(applyReviewedDealerSeed(listings.client as never, request())).rejects.toThrow(/listings/);
    const identities = fakeClient({ identities: 2 });
    await expect(applyReviewedDealerSeed(identities.client as never, request())).rejects.toThrow(/identities/);
    const jobs = fakeClient({ applyJobs: 1 });
    await expect(applyReviewedDealerSeed(jobs.client as never, request())).rejects.toThrow(/apply job/);
    const created = fakeClient({});
    const receipt = await applyReviewedDealerSeed(created.client as never, request());
    expect(receipt).toMatchObject({ outcome: "applied", wrote: true, dealerId: "dealer-1" });
    expect(created.calls.binding[0]).toMatchObject({ enabled: false, registryKey: "dw-cars", verifiedById: "admin-user-1" });
    expect(created.calls.jobs[0]).toMatchObject({ status: "SUCCEEDED", kind: "SCRAPE" });
    expect(created.calls.plan).toMatchObject({ reviewSource: { sourceHash: "c".repeat(64), coverageWarning: "coverage warning" } });
  });

  it("rejects removal semantics and exposes capacity without dropping the warning", () => {
    const prior: SyncIdentity = {
      sourceIdentityKey: "sourceVehicleId:old",
      listingId: "listing-1",
      absenceCount: 0,
      lastAbsenceRunId: null,
      lastSeenRunId: null,
      baselinePricePence: null,
      baselineMileage: null,
    };
    expect(() => planReviewedAdditions({
      registryKey: "dw-cars",
      scrapeRunId: "run-1",
      regionId: "region-1",
      listings: [],
      identities: [prior],
      adaptation,
      activeListingCount: 0,
      listingCap: 30,
    })).toThrow(/absent/);
    expect(reviewedCapacityWarning({ regionId: null, activeListingCount: 0, listingCap: 30, createCount: 0 })).toMatch(/region/);
    expect(reviewedCapacityWarning({ regionId: "region-1", activeListingCount: 30, listingCap: 30, createCount: 1 })).toMatch(/30 of 30/);
    const vehicle: InventoryVehicle = {
      sourceIdentityKey: "sourceVehicleId:new",
      availability: "available",
      isPoa: false,
      pricePence: 100_000,
      mileage: 10,
      importable: true,
      skipReason: null,
      title: "2024 Ford Focus",
      description: "A description that is long enough to keep.",
      categorySlug: "car",
      attributes: { make: "Ford", model: "Focus", year: "2024", mileage: "10" },
      ownedImages: [],
      remoteImageCount: 1,
      sourceImageUrls: ["https://dealer.example/safe.jpg"],
    };
    const open = planReviewedAdditions({
      registryKey: "dw-cars",
      scrapeRunId: "run-1",
      regionId: null,
      listings: [],
      identities: [],
      adaptation: { ...adaptation, vehicles: [vehicle], evidence: {} },
      activeListingCount: 0,
      listingCap: 30,
    });
    expect(open.actions.some((action) => action.kind === "unpublish" || action.kind === "missing_once")).toBe(false);
    expect(open.capacityWarning).toMatch(/region/);
    const patched = identitiesAfterPatches([], open.patches);
    const base = {
      dealer: { id: "dealer-1", userId: "user-1", regionId: null, tier: "STARTER", isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
      binding: { id: "binding-1", registryKey: "dw-cars", enabled: false, verifiedAt: null },
      activeListingCount: 0,
      listingCap: 30,
      listings: [],
      identities: [] as SyncIdentity[],
      actions: open.actions,
    };
    expect(fingerprintSnapshot({ ...base, identities: patched })).not.toBe(fingerprintSnapshot(base));
  });
});
