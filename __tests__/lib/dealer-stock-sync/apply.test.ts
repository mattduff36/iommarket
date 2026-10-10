import { describe, expect, it, vi } from "vitest";
import { applyFrozenPlan, type ApplyWriter } from "@/lib/dealer-stock-sync/apply";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

function snapshot(actions: PlanAction[], listingPrice = 1_000_000): FingerprintSnapshot {
  return {
    dealer: {
      id: "dealer",
      userId: "user",
      regionId: "region",
      tier: "STARTER",
      isAdminPreview: false,
      role: "DEALER",
      disabledAt: null,
      deletedAt: null,
    },
    binding: { id: "binding", registryKey: "franklins", enabled: true, verifiedAt: "2026-06-01T00:00:00.000Z" },
    activeListingCount: 1,
    listingCap: 30,
    listings: [
      {
        id: "listing-1",
        status: "LIVE",
        price: listingPrice,
        mileage: 10_000,
        featured: false,
        expiresAt: "2026-12-01T00:00:00.000Z",
        soldAt: null,
        lifecycleRevision: 4,
        photoRevision: 2,
        reviewSourceIdentity: "sourceVehicleId:1",
        slug: null,
        previewPackId: null,
        openRevision: false,
      },
    ],
    identities: [
      {
        sourceIdentityKey: "sourceVehicleId:1",
        listingId: "listing-1",
        absenceCount: 0,
        lastAbsenceRunId: null,
        lastSeenRunId: "run",
        baselinePricePence: 1_000_000,
        baselineMileage: 10_000,
      },
    ],
    actions,
  };
}

function writer() {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const create = vi.fn(async () => ({ id: "created" }));
  return {
    calls: { updateMany, create },
    client: {
      listing: { updateMany, create },
      listingAttributeValue: { updateMany, createMany: vi.fn(async () => ({ count: 1 })) },
      listingImage: { createMany: vi.fn(async () => ({ count: 1 })) },
      listingStatusEvent: { create: vi.fn(async () => ({ id: "event" })) },
      category: { findFirst: vi.fn(async () => ({ id: "car" })) },
      region: { findFirst: vi.fn(async () => ({ id: "region" })) },
      attributeDefinition: { findMany: vi.fn(async () => []) },
      dealerStockSourceIdentity: { updateMany },
      dealerStockSyncReport: { updateMany },
      dealerStockSyncAudit: { create: vi.fn(async () => ({ id: "audit" })) },
    } satisfies ApplyWriter,
  };
}

const update: PlanAction = {
  kind: "update",
  sourceIdentityKey: "sourceVehicleId:1",
  listingId: "listing-1",
  lifecycleRevision: 4,
  photoRevision: 2,
  featured: false,
  changes: [{ field: "price", before: 1_000_000, after: 900_000 }],
};

describe("applyFrozenPlan", () => {
  it("rejects a stale snapshot before writing listings", async () => {
    const current = snapshot([update], 800_000);
    const stored = fingerprintSnapshot(snapshot([update]));
    const { client, calls } = writer();
    await expect(
      applyFrozenPlan({
        client,
        snapshot: current,
        storedFingerprint: stored,
        reportId: "report",
        reportStatus: "APPROVED",
        actorId: "admin",
        jobId: "job",
        now: new Date("2026-06-19T05:00:00.000Z"),
        takeDown: vi.fn(),
      }),
    ).rejects.toThrow(/stale/i);
    expect(calls.updateMany).not.toHaveBeenCalled();
  });

  it("updates price without rewriting content fields and refuses superseded or over-cap plans", async () => {
    const current = snapshot([update]);
    const { client, calls } = writer();
    const result = await applyFrozenPlan({
      client,
      snapshot: current,
      storedFingerprint: fingerprintSnapshot(current),
      reportId: "report",
      reportStatus: "APPROVED",
      actorId: "admin",
      jobId: "job",
      now: new Date("2026-06-19T05:00:00.000Z"),
      takeDown: vi.fn(),
    });
    expect(result.status).toBe("applied");
    const callsList = calls.updateMany.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const data = callsList[0]?.[0].data ?? {};
    expect(data.price).toBe(900_000);
    expect(callsList.some(([call]) => call.data.baselinePricePence === 900_000)).toBe(true);
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("description");
    expect(data).not.toHaveProperty("featured");
    expect(data).not.toHaveProperty("expiresAt");

    await expect(
      applyFrozenPlan({
        client,
        snapshot: current,
        storedFingerprint: fingerprintSnapshot(current),
        reportId: "report",
        reportStatus: "SUPERSEDED",
        actorId: "admin",
        jobId: "job",
        now: new Date(),
        takeDown: vi.fn(),
      }),
    ).rejects.toThrow(/no longer be applied/i);

    const createSnapshot = snapshot([
      {
        kind: "create",
        sourceIdentityKey: "sourceVehicleId:2",
        listingId: null,
        title: "2018 Ford Focus",
        description: "A complete description used only when creating a new listing.",
        pricePence: 500_000,
        categorySlug: "car",
        attributes: {},
        ownedImages: [
          {
            publicId: "listings/dealer/listing/1",
            url: "https://res.cloudinary.com/demo/image/upload/v1/listings/dealer/listing/1.jpg",
            provider: "CLOUDINARY",
            width: 1200,
            height: 800,
            order: 0,
          },
        ],
        changes: [],
      },
    ]);
    createSnapshot.activeListingCount = 30;
    await expect(
      applyFrozenPlan({
        client,
        snapshot: createSnapshot,
        storedFingerprint: fingerprintSnapshot(createSnapshot),
        reportId: "report",
        reportStatus: "APPROVED",
        actorId: "admin",
        jobId: "job",
        now: new Date(),
        takeDown: vi.fn(),
      }),
    ).rejects.toThrow(/cap/i);
  });

  it("is idempotent when the report was already applied", async () => {
    const current = snapshot([update]);
    const { client, calls } = writer();
    const result = await applyFrozenPlan({
      client,
      snapshot: current,
      storedFingerprint: fingerprintSnapshot(current),
      reportId: "report",
      reportStatus: "APPLIED",
      actorId: "admin",
      jobId: "job",
      now: new Date(),
      takeDown: vi.fn(),
    });
    expect(result.status).toBe("already-applied");
    expect(calls.create).not.toHaveBeenCalled();
  });
});
