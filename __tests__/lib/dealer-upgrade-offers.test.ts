import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDealerUpgradePolicySnapshot } from "@/lib/dealers/upgrade-policy";

const {
  mockDb,
  tx,
  provisionDealerProfileMock,
  grantAdminDealerAccessMock,
  recordAcceptanceMock,
  sendStrictResendEmailMock,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    dealerUpgradeOffer: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  tx: {
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    dealerUpgradeOffer: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    dealerUpgradeAcceptance: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
  },
  provisionDealerProfileMock: vi.fn(),
  grantAdminDealerAccessMock: vi.fn(),
  recordAcceptanceMock: vi.fn(),
  sendStrictResendEmailMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/dealers/access", () => ({
  provisionDealerProfile: provisionDealerProfileMock,
}));
vi.mock("@/lib/dealers/entitlement", () => ({
  grantAdminDealerAccess: grantAdminDealerAccessMock,
}));
vi.mock("@/lib/policy/acceptance", () => ({
  recordAcceptance: recordAcceptanceMock,
}));
vi.mock("@/lib/email/send-strict", () => ({
  sendStrictResendEmail: sendStrictResendEmailMock,
}));

const user = {
  id: "cluserxxxxxxxxxxxxxxxxxxxxxx",
  email: "private@example.im",
  name: "Private Seller",
  role: "USER",
  disabledAt: null,
  deletedAt: null,
  dealerProfile: null,
};

const offer = {
  id: "clofferxxxxxxxxxxxxxxxxxxxx",
  userId: user.id,
  createdByAdminId: "cladminxxxxxxxxxxxxxxxxxxxx",
  durationDays: 90,
  status: "PENDING",
};

describe("dealer upgrade offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.dealerUpgradeOffer.findFirst.mockReset();
    tx.dealerUpgradeAcceptance.findUnique.mockReset();
    mockDb.dealerUpgradeOffer.updateMany.mockReset();
    mockDb.dealerUpgradeOffer.findUnique.mockReset();
    mockDb.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.user.findUnique.mockResolvedValue(user);
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.dealerUpgradeOffer.findFirst.mockResolvedValue(offer);
    tx.dealerUpgradeOffer.updateMany.mockResolvedValue({ count: 1 });
    tx.dealerUpgradeOffer.create.mockResolvedValue(offer);
    tx.dealerUpgradeAcceptance.findUnique.mockResolvedValue(null);
    tx.dealerUpgradeAcceptance.create.mockResolvedValue({
      id: "clreceiptxxxxxxxxxxxxxxxxx",
    });
    tx.subscription.findFirst.mockResolvedValue(null);
    provisionDealerProfileMock.mockResolvedValue({
      id: "cldealerxxxxxxxxxxxxxxxxxxx",
    });
    grantAdminDealerAccessMock.mockResolvedValue({
      kind: "granted",
      subscription: {
        id: "clgrantxxxxxxxxxxxxxxxxxxxx",
        grantStartsAt: new Date(),
        grantEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    });
    recordAcceptanceMock.mockResolvedValue({ id: "clacceptancexxxxxxxxxxxxxx" });
    mockDb.dealerUpgradeOffer.updateMany.mockResolvedValue({ count: 1 });
    sendStrictResendEmailMock.mockResolvedValue({ id: "email-message-id" });
  });

  it("creates a pending offer without provisioning dealer access", async () => {
    const { createPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );

    const result = await createPendingDealerUpgradeOffer({
      userId: user.id,
      adminId: offer.createdByAdminId,
      durationDays: offer.durationDays,
    });

    expect(result).toEqual(expect.objectContaining({ kind: "created", offer }));
    expect(tx.dealerUpgradeOffer.updateMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        status: "PENDING",
        OR: [
          { emailClaimedAt: null },
          { emailClaimedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        status: "CANCELLED",
        cancelledAt: expect.any(Date),
        cancelledByAdminId: offer.createdByAdminId,
        emailClaimedAt: null,
        emailClaimToken: null,
      },
    });
    expect(provisionDealerProfileMock).not.toHaveBeenCalled();
    expect(grantAdminDealerAccessMock).not.toHaveBeenCalled();
  });

  it("records current dealer consent and activates access atomically", async () => {
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );
    const now = new Date("2026-09-28T21:00:00.000Z");
    const policy = buildDealerUpgradePolicySnapshot();
    grantAdminDealerAccessMock.mockResolvedValueOnce({
      kind: "granted",
      subscription: {
        id: "clgrantxxxxxxxxxxxxxxxxxxxx",
        grantStartsAt: now,
        grantEndsAt: new Date(now.getTime() + 90 * 86_400_000),
      },
    });

    const result = await acceptPendingDealerUpgradeOffer({
      userId: user.id,
      offerId: offer.id,
      policyDigest: policy.digest,
      now,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "accepted",
        dealerId: "cldealerxxxxxxxxxxxxxxxxxxx",
      }),
    );
    expect(recordAcceptanceMock).toHaveBeenCalledWith(tx, {
      userId: user.id,
      acceptanceType: "DEALER_BUNDLE",
      source: "ADMIN_UPGRADE",
    });
    expect(grantAdminDealerAccessMock).toHaveBeenCalledWith(tx, {
      dealerId: "cldealerxxxxxxxxxxxxxxxxxxx",
      adminId: offer.createdByAdminId,
      durationDays: 90,
      now,
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, role: "USER" },
      data: { role: "DEALER" },
    });
    expect(tx.dealerUpgradeOffer.updateMany).toHaveBeenCalledWith({
      where: { id: offer.id, status: "PENDING" },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        emailClaimedAt: null,
        emailClaimToken: null,
      },
    });
    expect(tx.dealerUpgradeAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        offerId: offer.id,
        userId: user.id,
        source: "ADMIN_UPGRADE",
        bundleVersion: expect.stringMatching(/^DEALER_BUNDLE:/),
        contentHashes: expect.objectContaining({
          "dealer-terms": expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        acceptedAt: now,
      }),
    });
  });

  it("does not partially activate when an active paid subscription conflicts", async () => {
    tx.user.findUnique.mockResolvedValue({
      ...user,
      dealerProfile: { id: "cldealerxxxxxxxxxxxxxxxxxxx" },
    });
    tx.subscription.findFirst.mockResolvedValue({
      id: "clpaidsubscriptionxxxxxxxxx",
    });
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );
    const policy = buildDealerUpgradePolicySnapshot();
    await expect(
      acceptPendingDealerUpgradeOffer({
        userId: user.id,
        offerId: offer.id,
        policyDigest: policy.digest,
      }),
    ).resolves.toEqual({ kind: "paid-conflict" });

    expect(recordAcceptanceMock).not.toHaveBeenCalled();
    expect(grantAdminDealerAccessMock).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("treats a completed activation retry as idempotent", async () => {
    tx.user.findUnique.mockResolvedValue({ ...user, role: "DEALER" });
    tx.dealerUpgradeOffer.findFirst.mockResolvedValueOnce(null);
    tx.dealerUpgradeAcceptance.findUnique.mockResolvedValueOnce({
      id: "clreceiptxxxxxxxxxxxxxxxxx",
      userId: user.id,
    });
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );
    await expect(
      acceptPendingDealerUpgradeOffer({
        userId: user.id,
        offerId: offer.id,
        policyDigest: "0".repeat(64),
      }),
    ).resolves.toEqual({ kind: "already-accepted" });

    expect(recordAcceptanceMock).not.toHaveBeenCalled();
  });

  it("does not accept a replacement offer from a stale page", async () => {
    tx.dealerUpgradeOffer.findFirst.mockResolvedValueOnce(null);
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );
    const policy = buildDealerUpgradePolicySnapshot();

    await expect(
      acceptPendingDealerUpgradeOffer({
        userId: user.id,
        offerId: "clstaleofferxxxxxxxxxxxxxx",
        policyDigest: policy.digest,
      }),
    ).resolves.toEqual({ kind: "not-pending" });

    expect(recordAcceptanceMock).not.toHaveBeenCalled();
    expect(grantAdminDealerAccessMock).not.toHaveBeenCalled();
  });

  it("requires a fresh review when the policy digest changes", async () => {
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );

    await expect(
      acceptPendingDealerUpgradeOffer({
        userId: user.id,
        offerId: offer.id,
        policyDigest: "0".repeat(64),
      }),
    ).resolves.toEqual({ kind: "policy-changed" });

    expect(recordAcceptanceMock).not.toHaveBeenCalled();
  });

  it("does not replay another user's accepted offer", async () => {
    tx.dealerUpgradeAcceptance.findUnique.mockResolvedValueOnce({
      id: "clreceiptxxxxxxxxxxxxxxxxx",
      userId: "cldifferentuserxxxxxxxxxxxx",
    });
    const { acceptPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );
    const policy = buildDealerUpgradePolicySnapshot();

    await expect(
      acceptPendingDealerUpgradeOffer({
        userId: user.id,
        offerId: offer.id,
        policyDigest: policy.digest,
      }),
    ).resolves.toEqual({ kind: "not-pending" });

    expect(recordAcceptanceMock).not.toHaveBeenCalled();
  });

  it("claims email delivery so cancellation cannot race the send", async () => {
    let claimToken = "";
    mockDb.dealerUpgradeOffer.updateMany.mockImplementation(async ({ data }) => {
      if (data.emailClaimToken) claimToken = data.emailClaimToken;
      return { count: 1 };
    });
    mockDb.dealerUpgradeOffer.findUnique.mockImplementation(async () => ({
      ...offer,
      updatedAt: new Date("2026-09-28T20:00:00.000Z"),
      emailClaimToken: claimToken,
      user: { email: user.email, name: user.name },
    }));
    const { deliverDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );

    await expect(deliverDealerUpgradeOffer(offer.id)).resolves.toEqual({
      kind: "sent",
    });

    expect(sendStrictResendEmailMock).toHaveBeenCalledTimes(1);
    expect(mockDb.dealerUpgradeOffer.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: offer.id,
        status: "PENDING",
        emailClaimToken: claimToken,
      },
      data: expect.objectContaining({
        emailMessageId: "email-message-id",
        emailClaimedAt: null,
        emailClaimToken: null,
      }),
    });
  });

  it("allows an administrator to recover and cancel an expired email claim", async () => {
    const { cancelPendingDealerUpgradeOffer } = await import(
      "@/lib/dealers/upgrade-offers"
    );

    await cancelPendingDealerUpgradeOffer(offer.id, offer.createdByAdminId);

    expect(mockDb.dealerUpgradeOffer.updateMany).toHaveBeenCalledWith({
      where: {
        id: offer.id,
        status: "PENDING",
        OR: [
          { emailClaimToken: null },
          { emailClaimedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        status: "CANCELLED",
        cancelledAt: expect.any(Date),
        cancelledByAdminId: offer.createdByAdminId,
        emailClaimedAt: null,
        emailClaimToken: null,
      },
    });
  });
});
