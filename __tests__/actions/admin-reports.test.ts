import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  transitionListingStatusMock,
  logAdminActionMock,
  revalidatePathMock,
  reportFindUnique,
  reportUpdate,
  transaction,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  reportFindUnique: vi.fn(),
  reportUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications: vi.fn(),
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    report: {
      findUnique: reportFindUnique,
    },
    $transaction: transaction,
  },
}));

describe("takeDownListingFromReport ALR-RPT-001 ALR-RPT-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    reportFindUnique.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      listingId: "cllistingxxxxxxxxxxxxxxxxxx",
      listing: { id: "cllistingxxxxxxxxxxxxxxxxxx", status: "LIVE", lifecycleRevision: 3 },
    });
    reportUpdate.mockResolvedValue({ status: "ACTIONED" });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: "cllistingxxxxxxxxxxxxxxxxxx", status: "TAKEN_DOWN" },
      notification: { eventId: "evt-1" },
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        report: { update: reportUpdate },
      }),
    );
  });

  it("takes down a live listing, marks the report actioned, and audits in one transaction", async () => {
    const { takeDownListingFromReport } = await import("@/actions/admin");
    const result = await takeDownListingFromReport({
      reportId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedRevision: 3,
      reasonCode: "FRAUD",
      adminNotes: "Confirmed scam",
    });

    expect(result).toEqual({ data: { actioned: true } });
    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "cllistingxxxxxxxxxxxxxxxxxx",
        action: "TAKE_DOWN",
        expectedRevision: 3,
        reasonCode: "FRAUD",
        reportId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
      expect.anything(),
    );
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: "clxxxxxxxxxxxxxxxxxxxxxxxxx" },
      data: { status: "ACTIONED", adminNotes: "Confirmed scam" },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TAKE_DOWN_FROM_REPORT",
        entityId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
      expect.anything(),
    );
  });

  it("is idempotent when the listing is already taken down", async () => {
    reportFindUnique.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      listingId: "cllistingxxxxxxxxxxxxxxxxxx",
      listing: {
        id: "cllistingxxxxxxxxxxxxxxxxxx",
        status: "TAKEN_DOWN",
        lifecycleRevision: 4,
      },
    });
    const { takeDownListingFromReport } = await import("@/actions/admin");
    await takeDownListingFromReport({
      reportId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedRevision: 4,
      reasonCode: "FRAUD",
    });
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(reportUpdate).toHaveBeenCalled();
  });

  it("does not mark a sold listing as actioned", async () => {
    reportFindUnique.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      listingId: "cllistingxxxxxxxxxxxxxxxxxx",
      listing: { id: "cllistingxxxxxxxxxxxxxxxxxx", status: "SOLD", lifecycleRevision: 6 },
    });
    const { takeDownListingFromReport } = await import("@/actions/admin");
    await expect(
      takeDownListingFromReport({
        reportId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        expectedRevision: 6,
        reasonCode: "FRAUD",
      }),
    ).resolves.toEqual({
      error: "This listing cannot be taken down from its current status.",
    });
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(reportUpdate).not.toHaveBeenCalled();
  });
});
