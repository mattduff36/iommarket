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
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
  role: "USER",
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
    transaction.dealerProfile.update.mockResolvedValue({
      id: "cldealerxxxxxxxxxxxxxxxxx",
      tier: "STARTER",
    });
    transaction.subscription.findFirst.mockResolvedValue(null);
    transaction.subscription.create.mockImplementation(async ({ data }) => ({
      id: "clgrantxxxxxxxxxxxxxxxxxx",
      ...data,
    }));
    transaction.subscription.updateMany.mockResolvedValue({ count: 1 });
    transaction.user.update.mockImplementation(async ({ data }) => ({
      ...targetUser,
      role: data.role,
    }));
    mockDb.$transaction.mockImplementation(async (callback) => callback(transaction));
  });

  it("atomically provisions a dealer profile when promoting a user", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await expect(
      setUserRole({
        userId: targetUser.id,
        role: "DEALER",
        grantDurationDays: 90,
      })
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
    expect(transaction.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealerId: "cldealerxxxxxxxxxxxxxxxxx",
        source: "ADMIN_GRANT",
        paymentProvider: "ADMIN",
        status: "ACTIVE",
        grantedByAdminId: "cladminxxxxxxxxxxxxxxxxxx",
      }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SET_USER_ROLE",
        entityId: targetUser.id,
        details: expect.objectContaining({
          dealerAccessSource: "ADMIN_GRANT",
          grantDurationDays: 90,
        }),
      })
    );
  });

  it("requires an explicit valid duration for a non-dealer promotion", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    const result = await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
    });

    expect(result).toEqual({
      error: {
        grantDurationDays: [
          "Choose a valid free dealer access duration before promoting this account.",
        ],
      },
    });
    expect(transaction.dealerProfile.upsert).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the same promotion is submitted repeatedly", async () => {
    const profiles = new Map<string, { id: string; userId: string }>();
    let adminGrant: {
      id: string;
      grantStartsAt: Date;
      grantEndsAt: Date;
    } | null = null;
    transaction.dealerProfile.upsert.mockImplementation(async ({ create }) => {
      const existing = profiles.get(create.userId);
      if (existing) return existing;

      const profile = { id: "cldealerxxxxxxxxxxxxxxxxx", userId: create.userId };
      profiles.set(create.userId, profile);
      return profile;
    });
    transaction.subscription.findFirst.mockImplementation(async ({ where }) => {
      if (where.source === "PAYMENT") return null;
      return adminGrant;
    });
    transaction.subscription.create.mockImplementation(async ({ data }) => {
      adminGrant = {
        id: "clgrantxxxxxxxxxxxxxxxxxx",
        grantStartsAt: data.grantStartsAt,
        grantEndsAt: data.grantEndsAt,
      };
      return { ...adminGrant, ...data };
    });
    transaction.subscription.update.mockImplementation(async ({ data }) => {
      adminGrant = {
        id: "clgrantxxxxxxxxxxxxxxxxxx",
        grantStartsAt: data.grantStartsAt,
        grantEndsAt: data.grantEndsAt,
      };
      return { ...adminGrant, ...data };
    });
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
      grantDurationDays: 30,
    });
    await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
      grantDurationDays: 30,
    });

    expect(profiles.size).toBe(1);
    expect(transaction.dealerProfile.upsert).toHaveBeenCalledTimes(2);
    expect(transaction.subscription.create).toHaveBeenCalledTimes(1);
    expect(transaction.subscription.update).toHaveBeenCalledTimes(1);
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
          update: transaction.dealerProfile.update,
        },
        subscription: transaction.subscription,
      };

      await callback(failingTransaction);
      Object.assign(state, stagedState);
    });
    const { setUserRole } = await import("@/actions/admin/users");

    await expect(
      setUserRole({
        userId: targetUser.id,
        role: "DEALER",
        grantDurationDays: 30,
      })
    ).resolves.toEqual({ error: "Failed to update role" });

    expect(state).toEqual({ role: "USER", profile: null });
  });

  it("demotes without deleting the existing dealer profile", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({ userId: targetUser.id, role: "USER" });

    expect(transaction.dealerProfile.upsert).not.toHaveBeenCalled();
    expect(transaction.subscription.create).not.toHaveBeenCalled();
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: targetUser.id },
      data: { role: "USER" },
    });
  });

  it("preserves active paid access instead of creating an admin grant", async () => {
    transaction.subscription.findFirst.mockResolvedValueOnce({
      id: "clpaidsubscriptionxxxxxxxxx",
    });
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
      grantDurationDays: 30,
    });

    expect(transaction.subscription.create).not.toHaveBeenCalled();
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ dealerAccessSource: "PAYMENT" }),
      })
    );
  });
});

describe("dealer account lookup rules", () => {
  it("includes promoted dealer accounts in the admin dealer query", () => {
    expect(getAdminDealerWhere()).toEqual({
      isAdminPreview: false,
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

describe("grantDealerAccess repair action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    transaction.user.findUnique.mockResolvedValue({
      ...targetUser,
      role: "DEALER",
    });
    transaction.dealerProfile.upsert.mockResolvedValue({
      id: "cldealerxxxxxxxxxxxxxxxxx",
      userId: targetUser.id,
    });
    transaction.subscription.findFirst.mockResolvedValue(null);
    transaction.subscription.create.mockImplementation(async ({ data }) => ({
      id: "clgrantxxxxxxxxxxxxxxxxxx",
      ...data,
    }));
    mockDb.$transaction.mockImplementation(async (callback) =>
      callback(transaction)
    );
  });

  it("repairs an existing dealer account without paid or granted access", async () => {
    const { grantDealerAccess } = await import("@/actions/admin/users");

    const result = await grantDealerAccess({
      userId: targetUser.id,
      durationDays: 60,
    });

    expect(result).toEqual({
      data: {
        source: "ADMIN_GRANT",
        endsAt: expect.any(Date),
      },
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: "ADMIN_GRANT",
        dealerId: "cldealerxxxxxxxxxxxxxxxxx",
      }),
    });
  });

  it("denies a non-admin grant request", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Insufficient permissions"));
    const { grantDealerAccess } = await import("@/actions/admin/users");

    await expect(
      grantDealerAccess({ userId: targetUser.id, durationDays: 30 })
    ).rejects.toThrow("Insufficient permissions");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("setDealerTier", () => {
  const dealerUser = {
    id: targetUser.id,
    dealerProfile: { id: "cldealerxxxxxxxxxxxxxxxxx", tier: "STARTER" as const },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    transaction.user.findUnique.mockResolvedValue(dealerUser);
    transaction.subscription.findFirst.mockResolvedValue(null);
    transaction.dealerProfile.update.mockResolvedValue({
      id: dealerUser.dealerProfile.id,
      tier: "PRO",
    });
    mockDb.$transaction.mockImplementation(async (callback) =>
      callback(transaction)
    );
  });

  it("admin-set-dealer-tier-grant: complimentary dealer can be moved to Pro with an audit row", async () => {
    const { setDealerTier } = await import("@/actions/admin/dealer-tier");

    await expect(
      setDealerTier({ userId: targetUser.id, tier: "PRO" })
    ).resolves.toEqual({ data: { tier: "PRO" } });

    expect(mockDb.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    expect(transaction.dealerProfile.update).toHaveBeenCalledWith({
      where: { id: dealerUser.dealerProfile.id },
      data: { tier: "PRO" },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      {
        adminId: "cladminxxxxxxxxxxxxxxxxxx",
        action: "SET_DEALER_TIER",
        entityType: "DealerProfile",
        entityId: dealerUser.dealerProfile.id,
        details: {
          userId: targetUser.id,
          dealerId: dealerUser.dealerProfile.id,
          previousTier: "STARTER",
          nextTier: "PRO",
          paidBlocked: false,
        },
      },
      transaction,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
    expect(revalidatePathMock).toHaveBeenCalledWith(`/admin/users/${targetUser.id}`);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/dealers");
  });

  it("admin-set-dealer-tier-paid-blocked: active paid subscription blocks the write", async () => {
    transaction.subscription.findFirst.mockResolvedValue({ id: "clpaidxxxxxxxxxxxxxxxxxxxx" });
    const { setDealerTier } = await import("@/actions/admin/dealer-tier");

    await expect(
      setDealerTier({ userId: targetUser.id, tier: "PRO" })
    ).resolves.toEqual({
      error: "Package is set by the paid subscription and cannot be changed.",
    });
    expect(transaction.subscription.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        dealerId: dealerUser.dealerProfile.id,
        source: "PAYMENT",
        status: "ACTIVE",
        currentPeriodEnd: { gt: expect.any(Date) },
      }),
      select: { id: true },
    });
    expect(transaction.dealerProfile.update).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });

  it("admin-set-dealer-tier-no-profile: user without a dealer profile is rejected", async () => {
    transaction.user.findUnique.mockResolvedValue({
      id: targetUser.id,
      dealerProfile: null,
    });
    const { setDealerTier } = await import("@/actions/admin/dealer-tier");

    await expect(
      setDealerTier({ userId: targetUser.id, tier: "PRO" })
    ).resolves.toEqual({
      error: "This account has no dealer profile.",
    });
    expect(transaction.dealerProfile.update).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });
});
