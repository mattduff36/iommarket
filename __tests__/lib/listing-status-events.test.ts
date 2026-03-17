import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTx, mockDb } = vi.hoisted(() => {
  const tx = {
    listing: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    listingStatusEvent: {
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

  it("updates listing and writes a status event when status changes", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "DRAFT",
    });
    mockTx.listing.update.mockResolvedValue({
      id: "listing-1",
      status: "PENDING",
    });

    const result = await transitionListingStatus({
      listingId: "listing-1",
      toStatus: "PENDING",
      changedByUserId: "user-1",
      source: "USER",
      notes: "Submitted for moderation",
    });

    expect(result.status).toBe("PENDING");
    expect(mockTx.listing.update).toHaveBeenCalledTimes(1);
    expect(mockTx.listingStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "listing-1",
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        changedByUserId: "user-1",
        source: "USER",
      }),
    });
  });

  it("does not write a status event when status remains unchanged", async () => {
    mockTx.listing.findUnique.mockResolvedValue({
      id: "listing-2",
      status: "LIVE",
    });
    mockTx.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-2",
      status: "LIVE",
    });

    const result = await transitionListingStatus({
      listingId: "listing-2",
      toStatus: "LIVE",
      source: "SYSTEM",
    });

    expect(result.status).toBe("LIVE");
    expect(mockTx.listing.update).not.toHaveBeenCalled();
    expect(mockTx.listingStatusEvent.create).not.toHaveBeenCalled();
  });
});
