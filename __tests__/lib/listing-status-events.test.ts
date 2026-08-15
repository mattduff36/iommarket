import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTx, mockDb } = vi.hoisted(() => {
  const tx = {
    listing: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    listingStatusEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    report: {
      findUnique: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
  };

  const db = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => unknown) =>
      callback(tx)
    ),
  };

  return { mockTx: tx, mockDb: db };
});

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

import { transitionListingStatus } from "@/lib/listings/status-events";

describe("transitionListingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates listing and writes a status event when status changes ALR-LST-001", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "DRAFT",
      userId: "user-1",
      expiresAt: null,
      lifecycleRevision: 0,
    });
    mockTx.listing.updateMany.mockResolvedValue({ count: 1 });
    mockTx.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-1",
      status: "PENDING",
      lifecycleRevision: 1,
    });

    const result = await transitionListingStatus({
      listingId: "listing-1",
      action: "SUBMIT",
      expectedRevision: 0,
      actor: { id: "user-1", role: "USER" },
      source: "USER",
      notes: "Submitted for moderation",
    });

    expect(result.status).toBe("PENDING");
    expect(mockTx.listing.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.listingStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "listing-1",
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        action: "SUBMIT",
        changedByUserId: "user-1",
        source: "USER",
      }),
    });
    expect(mockTx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("writes an admin audit record for material admin actions ALR-AUD-001", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-5",
      status: "PENDING",
      userId: "user-1",
      expiresAt: null,
      lifecycleRevision: 1,
    });
    mockTx.listing.updateMany.mockResolvedValue({ count: 1 });
    mockTx.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-5",
      status: "REJECTED",
      lifecycleRevision: 2,
    });

    await transitionListingStatus({
      listingId: "listing-5",
      action: "REJECT",
      expectedRevision: 1,
      actor: { id: "admin-1", role: "ADMIN" },
      source: "ADMIN",
      reasonCode: "FRAUD",
    });

    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "LISTING_REJECT",
        entityType: "Listing",
        entityId: "listing-5",
      }),
    });
  });

  it("rejects a report that does not belong to the listing ALR-RPT-001", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-6",
      status: "LIVE",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 2,
    });
    mockTx.report.findUnique.mockResolvedValue({ listingId: "other-listing" });

    await expect(
      transitionListingStatus({
        listingId: "listing-6",
        action: "TAKE_DOWN",
        expectedRevision: 2,
        actor: { id: "admin-1", role: "ADMIN" },
        source: "ADMIN",
        reasonCode: "FRAUD",
        reportId: "report-1",
      }),
    ).rejects.toThrow("Report does not belong to this listing.");
    expect(mockTx.listing.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale revisions without writing ALR-LST-002", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-2",
      status: "LIVE",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 4,
    });

    await expect(
      transitionListingStatus({
        listingId: "listing-2",
        action: "TAKE_DOWN",
        expectedRevision: 3,
        actor: { id: "admin-1", role: "ADMIN" },
        source: "ADMIN",
        reasonCode: "FRAUD",
      }),
    ).rejects.toThrow("Listing status changed");

    expect(mockTx.listing.updateMany).not.toHaveBeenCalled();
    expect(mockTx.listingStatusEvent.create).not.toHaveBeenCalled();
  });

  it("rejects invalid transitions without writing ALR-LST-002", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-3",
      status: "SOLD",
      userId: "user-1",
      expiresAt: null,
      lifecycleRevision: 2,
    });

    await expect(
      transitionListingStatus({
        listingId: "listing-3",
        action: "TAKE_DOWN",
        expectedRevision: 2,
        actor: { id: "admin-1", role: "ADMIN" },
        source: "ADMIN",
        reasonCode: "FRAUD",
      }),
    ).rejects.toThrow("Invalid transition");

    expect(mockTx.listing.updateMany).not.toHaveBeenCalled();
  });

  it("blocks live restore when expiry has passed ALR-LST-004", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-4",
      status: "TAKEN_DOWN",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
      lifecycleRevision: 5,
    });
    mockTx.listingStatusEvent.findFirst.mockResolvedValue({ id: "event-1" });

    await expect(
      transitionListingStatus({
        listingId: "listing-4",
        action: "REINSTATE_LIVE",
        expectedRevision: 5,
        actor: { id: "admin-1", role: "ADMIN" },
        source: "ADMIN",
        reasonCode: "POLICY",
      }),
    ).rejects.toThrow("cannot be reinstated live");
  });
});
