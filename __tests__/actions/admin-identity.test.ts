import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  applyAccountDisableMock,
  mockDb,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  applyAccountDisableMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    user: {
      update: vi.fn(),
    },
    accountDeletionJob: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/listings/account-disable", () => ({
  applyAccountDisableToListings: applyAccountDisableMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

describe("admin identity lifecycle ALR-IDN-001 ALR-IDN-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        user: {
          update: mockDb.user.update,
        },
        accountDeletionJob: mockDb.accountDeletionJob,
      }),
    );
    mockDb.user.update.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      deletedAt: null,
    });
    mockDb.accountDeletionJob.findUnique.mockResolvedValue(null);
    mockDb.accountDeletionJob.updateMany.mockResolvedValue({ count: 1 });
  });

  it("rejects unauthorized callers", async () => {
    requireRoleMock.mockRejectedValue(new Error("Forbidden"));
    const { restoreUser } = await import("@/actions/admin/users");
    await expect(
      restoreUser({ userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx" }),
    ).rejects.toThrow("Forbidden");
  });

  it("restores a soft-deleted user without deleting payments or listings", async () => {
    const { restoreUser } = await import("@/actions/admin/users");
    const result = await restoreUser({ userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx" });
    expect(result.data).toBeDefined();
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "clxxxxxxxxxxxxxxxxxxxxxxxxx" },
      data: expect.objectContaining({ deletedAt: null }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RESTORE_USER",
        entityType: "User",
      }),
      expect.anything(),
    );
    expect(mockDb.accountDeletionJob.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a restorable deletion job before restoring POL-PRIV-001", async () => {
    mockDb.accountDeletionJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "REQUESTED",
    });
    const { restoreUser } = await import("@/actions/admin/users");
    await expect(
      restoreUser({ userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx" }),
    ).resolves.toEqual({
      data: expect.objectContaining({ id: "clxxxxxxxxxxxxxxxxxxxxxxxxx" }),
    });
    expect(mockDb.accountDeletionJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: { in: ["REQUESTED", "FAILED"] },
      },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
  });

  it("refuses restore after a completed deletion job POL-PRIV-001", async () => {
    mockDb.accountDeletionJob.findUnique.mockResolvedValue({
      status: "COMPLETED",
    });
    const { restoreUser } = await import("@/actions/admin/users");
    await expect(
      restoreUser({ userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx" }),
    ).resolves.toEqual({
      error:
        "This account has a processing or completed deletion job and cannot be restored.",
    });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
