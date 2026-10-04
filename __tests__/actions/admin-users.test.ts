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
  sendDealerAccessRevokedEmailMock,
  createPendingDealerUpgradeOfferMock,
  deliverDealerUpgradeOfferMock,
  findPendingDealerUpgradeOfferMock,
  cancelPendingDealerUpgradeOfferMock,
  mockDb,
  transaction,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  sendDealerAccessRevokedEmailMock: vi.fn(),
  createPendingDealerUpgradeOfferMock: vi.fn(),
  deliverDealerUpgradeOfferMock: vi.fn(),
  findPendingDealerUpgradeOfferMock: vi.fn(),
  cancelPendingDealerUpgradeOfferMock: vi.fn(),
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

vi.mock("@/lib/email/dealer-access-revoked", () => ({
  sendDealerAccessRevokedEmail: sendDealerAccessRevokedEmailMock,
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

vi.mock("@/lib/dealers/upgrade-offers", () => ({
  createPendingDealerUpgradeOffer: createPendingDealerUpgradeOfferMock,
  deliverDealerUpgradeOffer: deliverDealerUpgradeOfferMock,
  findPendingDealerUpgradeOffer: findPendingDealerUpgradeOfferMock,
  findPendingDealerUpgradeOfferById: findPendingDealerUpgradeOfferMock,
  cancelPendingDealerUpgradeOffer: cancelPendingDealerUpgradeOfferMock,
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
    sendDealerAccessRevokedEmailMock.mockReset().mockResolvedValue({ id: "email-id" });
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    createPendingDealerUpgradeOfferMock.mockResolvedValue({
      kind: "created",
      offer: {
        id: "clofferxxxxxxxxxxxxxxxxxxx",
        status: "PENDING",
      },
      user: targetUser,
    });
    deliverDealerUpgradeOfferMock.mockResolvedValue({ kind: "sent" });
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

  it("revokes only complimentary access and notifies the dealer", async () => {
    transaction.user.findUnique.mockResolvedValue({ ...targetUser, role: "DEALER", dealerProfile: { id: "dealer-1" } });
    const { revokeDealerAccess } = await import("@/actions/admin/users");
    await expect(revokeDealerAccess({ userId: targetUser.id })).resolves.toEqual({ data: { success: true } });
    expect(transaction.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { dealerId: "dealer-1", source: "ADMIN_GRANT", status: "ACTIVE" },
    }));
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(sendDealerAccessRevokedEmailMock).toHaveBeenCalledWith(targetUser.email);
    expect(revalidatePathMock).toHaveBeenCalledWith("/listings/[id]", "page");
  });

  it("reports notification failure without reporting a committed revocation as failed", async () => {
    transaction.user.findUnique.mockResolvedValue({ ...targetUser, dealerProfile: { id: "dealer-1" } });
    sendDealerAccessRevokedEmailMock.mockRejectedValue(new Error("Email unavailable"));
    const { revokeDealerAccess } = await import("@/actions/admin/users");
    await expect(revokeDealerAccess({ userId: targetUser.id })).resolves.toEqual({
      data: { success: true }, warning: expect.stringContaining("notification email could not be sent"),
    });
  });

  it("does not send a duplicate revocation notice when no grant remains", async () => {
    transaction.user.findUnique.mockResolvedValue({ ...targetUser, dealerProfile: { id: "dealer-1" } });
    transaction.subscription.updateMany.mockResolvedValue({ count: 0 });
    const { revokeDealerAccess } = await import("@/actions/admin/users");
    await expect(revokeDealerAccess({ userId: targetUser.id })).resolves.toHaveProperty("error");
    expect(sendDealerAccessRevokedEmailMock).not.toHaveBeenCalled();
  });

  it("creates a pending offer without activating the private user", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await expect(
      setUserRole({
        userId: targetUser.id,
        role: "DEALER",
        grantDurationDays: 90,
      })
    ).resolves.toEqual({
      data: expect.objectContaining({
        id: targetUser.id,
        role: "USER",
        offerStatus: "PENDING",
      }),
      warning: undefined,
    });

    expect(createPendingDealerUpgradeOfferMock).toHaveBeenCalledWith({
      userId: targetUser.id,
      adminId: "cladminxxxxxxxxxxxxxxxxxx",
      durationDays: 90,
    });
    expect(deliverDealerUpgradeOfferMock).toHaveBeenCalledWith(
      "clofferxxxxxxxxxxxxxxxxxxx",
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "OFFER_DEALER_UPGRADE",
        entityId: "clofferxxxxxxxxxxxxxxxxxxx",
        details: expect.objectContaining({
          grantDurationDays: 90,
          emailDelivered: true,
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

  it("replaces an existing pending offer when promotion is submitted again", async () => {
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

    expect(createPendingDealerUpgradeOfferMock).toHaveBeenCalledTimes(2);
    expect(deliverDealerUpgradeOfferMock).toHaveBeenCalledTimes(2);
    expect(transaction.dealerProfile.upsert).not.toHaveBeenCalled();
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it("keeps the offer pending and reports a warning when email delivery fails", async () => {
    deliverDealerUpgradeOfferMock.mockResolvedValueOnce({
      kind: "failed",
      message: "Email delivery failed.",
    });
    const { setUserRole } = await import("@/actions/admin/users");

    const result = await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
      grantDurationDays: 30,
    });

    expect(result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ offerStatus: "PENDING", role: "USER" }),
        warning: expect.stringMatching(/email was not sent/i),
      }),
    );
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

  it("does not inspect or alter subscriptions before acceptance", async () => {
    const { setUserRole } = await import("@/actions/admin/users");

    await setUserRole({
      userId: targetUser.id,
      role: "DEALER",
      grantDurationDays: 30,
    });

    expect(transaction.subscription.create).not.toHaveBeenCalled();
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.subscription.findFirst).not.toHaveBeenCalled();
  });
});

describe("dealer account lookup rules", () => {
  it("includes promoted dealer accounts in the admin dealer query", () => {
    expect(getAdminDealerWhere()).toEqual({
      isAdminPreview: false,
      user: {
        role: "DEALER",
        NOT: {
          OR: [
            { authUserId: { startsWith: "preview-system:" } },
            {
              email: {
                endsWith: "@preview.internal",
                mode: "insensitive",
              },
            },
          ],
        },
      },
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
    role: "DEALER" as const,
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

  it("rejects a downgraded user with a retained dealer profile", async () => {
    transaction.user.findUnique.mockResolvedValue({
      ...dealerUser,
      role: "USER",
    });
    const { setDealerTier } = await import("@/actions/admin/dealer-tier");

    await expect(
      setDealerTier({ userId: targetUser.id, tier: "PRO" }),
    ).resolves.toEqual({
      error: "Only dealer or admin accounts can change dealer package.",
    });
    expect(transaction.subscription.findFirst).not.toHaveBeenCalled();
    expect(transaction.dealerProfile.update).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });
});

describe("pending dealer upgrade administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    findPendingDealerUpgradeOfferMock.mockResolvedValue({
      id: "clofferxxxxxxxxxxxxxxxxxxx",
      userId: targetUser.id,
    });
    deliverDealerUpgradeOfferMock.mockResolvedValue({ kind: "sent" });
    cancelPendingDealerUpgradeOfferMock.mockResolvedValue({ count: 1 });
  });

  it("resends the current pending offer", async () => {
    const { resendDealerUpgradeOffer } = await import(
      "@/actions/admin/dealer-upgrade-offers"
    );

    await expect(
      resendDealerUpgradeOffer({ offerId: "clofferxxxxxxxxxxxxxxxxxxx" }),
    ).resolves.toEqual({ data: { success: true } });

    expect(deliverDealerUpgradeOfferMock).toHaveBeenCalledWith(
      "clofferxxxxxxxxxxxxxxxxxxx",
    );
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESEND_DEALER_UPGRADE_OFFER" }),
    );
  });

  it("cancels the current pending offer", async () => {
    const { cancelDealerUpgradeOffer } = await import(
      "@/actions/admin/dealer-upgrade-offers"
    );

    await expect(
      cancelDealerUpgradeOffer({ offerId: "clofferxxxxxxxxxxxxxxxxxxx" }),
    ).resolves.toEqual({ data: { success: true } });

    expect(cancelPendingDealerUpgradeOfferMock).toHaveBeenCalledWith(
      "clofferxxxxxxxxxxxxxxxxxxx",
      "cladminxxxxxxxxxxxxxxxxxx",
    );
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CANCEL_DEALER_UPGRADE_OFFER" }),
    );
  });
});
