import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  captureExceptionMock,
  revalidatePathMock,
  legalHoldMock,
  assertMock,
  deleteAuthUserMock,
  purgeMock,
  deleteMediaMock,
  loadTablesMock,
  mockDb,
  PurgeUserError,
} = vi.hoisted(() => {
  class PurgeUserError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PurgeUserError";
    }
  }
  return {
    requireRoleMock: vi.fn(),
    logAdminActionMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    legalHoldMock: vi.fn(),
    assertMock: vi.fn(),
    deleteAuthUserMock: vi.fn(),
    purgeMock: vi.fn(),
    deleteMediaMock: vi.fn(),
    loadTablesMock: vi.fn(),
    mockDb: { $transaction: vi.fn(), user: { findUnique: vi.fn() } },
    PurgeUserError,
  };
});

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/monitoring", () => ({ captureException: captureExceptionMock }));
vi.mock("@/lib/privacy/account-deletion", () => ({
  hasActiveLegalHold: legalHoldMock,
}));
vi.mock("@/lib/privacy/purge-user-account", () => ({
  assertUserCanBePurged: assertMock,
  deleteAuthUser: deleteAuthUserMock,
  purgeUserAccountRecords: purgeMock,
  deleteAccountMedia: deleteMediaMock,
  loadPublicTables: loadTablesMock,
  PurgeUserError,
}));
vi.mock("@/lib/dealers/upgrade-offers", () => ({
  createPendingDealerUpgradeOffer: vi.fn(),
  deliverDealerUpgradeOffer: vi.fn(),
  findPendingDealerUpgradeOffer: vi.fn(),
  findPendingDealerUpgradeOfferById: vi.fn(),
  cancelPendingDealerUpgradeOffer: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { deleteUser } from "@/actions/admin/users";

const userId = "cluserxxxxxxxxxxxxxxxxxxxx";

describe("deleteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureExceptionMock.mockResolvedValue(null);
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    legalHoldMock.mockResolvedValue(false);
    loadTablesMock.mockResolvedValue(new Set(["User"]));
    assertMock.mockResolvedValue(undefined);
    deleteAuthUserMock.mockResolvedValue(undefined);
    deleteMediaMock.mockResolvedValue({ failedPublicIds: [] });
    purgeMock.mockResolvedValue({
      email: "deleted.user@example.com",
      authUserId: "auth-1",
      imagePublicIds: ["photo-1"],
    });
    mockDb.user.findUnique.mockResolvedValue({
      id: userId,
      authUserId: "auth-1",
      dealerProfile: { id: "dealer-1" },
    });
    mockDb.$transaction.mockImplementation(async (callback: (tx: object) => unknown) =>
      callback({}),
    );
  });

  it("removes the login and then the database profile", async () => {
    const result = await deleteUser({ userId });

    expect(result).toEqual({ data: { success: true } });
    expect(deleteAuthUserMock).toHaveBeenCalledWith("auth-1");
    expect(purgeMock).toHaveBeenCalledWith(expect.any(Object), userId, expect.any(Set));
    expect(deleteAuthUserMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeMock.mock.invocationCallOrder[0],
    );
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE_USER", entityId: userId }),
      expect.any(Object),
    );
    expect(deleteMediaMock).toHaveBeenCalledWith(["photo-1"]);
    expect("update" in mockDb.user).toBe(false);
  });

  it("does not delete the profile when the login cannot be removed", async () => {
    deleteAuthUserMock.mockRejectedValue(
      new PurgeUserError("The login could not be removed, so the account was left unchanged."),
    );

    const result = await deleteUser({ userId });

    expect(result).toEqual({
      error: "The login could not be removed, so the account was left unchanged.",
    });
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("does not touch the login while a legal hold is active", async () => {
    legalHoldMock.mockResolvedValue(true);

    const result = await deleteUser({ userId });

    expect(result).toEqual({
      error: "This account is under a legal hold and cannot be deleted.",
    });
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("does not permit deleting the signed-in administrator", async () => {
    requireRoleMock.mockResolvedValue({ id: userId, role: "ADMIN" });
    expect(await deleteUser({ userId })).toEqual({ error: "Cannot delete your own account" });
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("stops before login removal when purge preflight fails", async () => {
    assertMock.mockRejectedValue(new PurgeUserError("Account deletion needs a database update."));
    expect(await deleteUser({ userId })).toEqual({ error: "Account deletion needs a database update." });
    expect(deleteAuthUserMock).not.toHaveBeenCalled();
  });

  it("does not instruct the admin to repeat a deterministic database failure", async () => {
    purgeMock.mockRejectedValue(new Error("constraint failure"));
    const result = await deleteUser({ userId });
    expect(result).toEqual({ error: expect.stringContaining("profile deletion failed") });
    expect(JSON.stringify(result)).not.toContain("Delete the account again");
  });

  it("does not report a remaining profile after postcommit media failure", async () => {
    deleteMediaMock.mockRejectedValue(new Error("media service unavailable"));
    expect(await deleteUser({ userId })).toEqual({ data: { success: true } });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("returns deletion success even if postcommit cleanup and monitoring both fail", async () => {
    deleteMediaMock.mockRejectedValue(new Error("media service unavailable"));
    captureExceptionMock.mockRejectedValue(new Error("monitoring unavailable"));
    expect(await deleteUser({ userId })).toEqual({ data: { success: true } });
  });
});
