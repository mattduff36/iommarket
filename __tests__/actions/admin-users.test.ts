import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminDealerWhere,
  hasDealerDashboardAccess,
} from "@/lib/dealers/access";

const {
  requireRoleMock,
  logAdminActionMock,
  captureExceptionMock,
  revalidatePathMock,
  mockDb,
  transaction,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
  },
  transaction: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dealerProfile: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const targetUser = {
  id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  name: "Manx Motors",
  email: "sales@manxmotors.im",
};

describe("setUserRole dealer provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    transaction.user.findUnique.mockResolvedValue(targetUser);
    transaction.dealerProfile.upsert.mockImplementation(async ({ create }) => ({
      id: "cldealerxxxxxxxxxxxxxxxxx",
      ...create,
    }));
    transaction.user.update.mockImplementation(async ({ data }) => ({
      ...targetUser,
      role: data.role,
    }));
    mockDb.$transaction.mockImplementation(async (callback) => callback(transaction));
  });

  it("atomically provisions a dealer profile when promoting a user", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await expect(
      setUserRole({ userId: targetUser.id, role: "DEALER" })
    ).resolves.toEqual({
      data: expect.objectContaining({ id: targetUser.id, role: "DEALER" }),
    });

    expect(transaction.dealerProfile.upsert).toHaveBeenCalledWith({
      where: { userId: targetUser.id },
      update: {},
      create: {
        userId: targetUser.id,
        name: "Manx Motors",
        slug: `dealer-${targetUser.id}`,
      },
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: targetUser.id },
      data: { role: "DEALER" },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SET_USER_ROLE", entityId: targetUser.id })
    );
  });

  it("is idempotent when the same promotion is submitted repeatedly", async () => {
    const profiles = new Map<string, { id: string; userId: string }>();
    transaction.dealerProfile.upsert.mockImplementation(async ({ create }) => {
      const existing = profiles.get(create.userId);
      if (existing) return existing;

      const profile = { id: "cldealerxxxxxxxxxxxxxxxxx", userId: create.userId };
      profiles.set(create.userId, profile);
      return profile;
    });
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({ userId: targetUser.id, role: "DEALER" });
    await setUserRole({ userId: targetUser.id, role: "DEALER" });

    expect(profiles.size).toBe(1);
    expect(transaction.dealerProfile.upsert).toHaveBeenCalledTimes(2);
  });

  it("does not commit either record when dealer provisioning fails", async () => {
    const state = { role: "USER", profile: null as null | { userId: string } };
    mockDb.$transaction.mockImplementation(async (callback) => {
      const stagedState = { ...state };
      const failingTransaction = {
        user: {
          findUnique: vi.fn().mockResolvedValue(targetUser),
          update: vi.fn().mockImplementation(async ({ data }) => {
            stagedState.role = data.role;
            throw new Error("role update failed");
          }),
        },
        dealerProfile: {
          upsert: vi.fn().mockImplementation(async ({ create }) => {
            stagedState.profile = { userId: create.userId };
            return stagedState.profile;
          }),
        },
      };

      await callback(failingTransaction);
      Object.assign(state, stagedState);
    });
    const { setUserRole } = await import("@/actions/admin/users");

    await expect(
      setUserRole({ userId: targetUser.id, role: "DEALER" })
    ).resolves.toEqual({ error: "Failed to update role" });

    expect(state).toEqual({ role: "USER", profile: null });
  });

  it("demotes without deleting the existing dealer profile", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({ userId: targetUser.id, role: "USER" });

    expect(transaction.dealerProfile.upsert).not.toHaveBeenCalled();
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: targetUser.id },
      data: { role: "USER" },
    });
  });
});

describe("dealer account lookup rules", () => {
  it("includes promoted dealer accounts in the admin dealer query", () => {
    expect(getAdminDealerWhere()).toEqual({
      user: { role: { in: ["DEALER", "ADMIN"] } },
    });
  });

  it("allows the dealer dashboard only for a dealer account with a profile", () => {
    expect(
      hasDealerDashboardAccess({
        role: "DEALER",
        dealerProfile: { id: "cldealerxxxxxxxxxxxxxxxxx" },
      })
    ).toBe(true);
    expect(
      hasDealerDashboardAccess({
        role: "DEALER",
        dealerProfile: null,
      })
    ).toBe(false);
  });
});
