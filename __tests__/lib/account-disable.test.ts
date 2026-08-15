import { beforeEach, describe, expect, it, vi } from "vitest";

const { transitionListingStatusMock } = vi.hoisted(() => ({
  transitionListingStatusMock: vi.fn(),
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

import { applyAccountDisableToListings } from "@/lib/listings/account-disable";

describe("account disable listings ALR-IDN-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes down live listings and rejects pending ones without deleting records", async () => {
    const tx = {
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { id: "live-1", status: "LIVE", lifecycleRevision: 2 },
          { id: "pending-1", status: "PENDING", lifecycleRevision: 1 },
        ]),
      },
    };

    await expect(
      applyAccountDisableToListings({
        tx: tx as never,
        userId: "user-1",
        actor: { id: "admin-1", role: "ADMIN" },
        source: "ADMIN",
        notes: "Account disabled",
      }),
    ).resolves.toBe(2);

    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "live-1",
        action: "ACCOUNT_DISABLE",
        reasonCode: "ACCOUNT_DISABLED",
      }),
      tx,
    );
    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "pending-1",
        action: "ACCOUNT_DISABLE_PENDING",
      }),
      tx,
    );
    expect(tx.listing.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: { in: ["PENDING", "APPROVED", "LIVE"] },
      },
      select: { id: true, status: true, lifecycleRevision: true },
    });
  });
});
