import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, mockDb, sendMock, findAuthUserMock, logAdminActionMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  sendMock: vi.fn(),
  findAuthUserMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  mockDb: {
    dealerPromotionCampaign: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    dealerProfile: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    dealerOnboardingInvite: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    dealerOnboardingInviteEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/email/send-strict", () => ({ sendStrictResendEmail: sendMock }));
vi.mock("@/lib/dealers/onboarding/auth-admin", () => ({ findAuthUserByEmail: findAuthUserMock }));
vi.mock("@/lib/seo/structured-data", () => ({
  getCanonicalBaseUrl: () => new URL("https://itrader.im"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendDealerOnboardingInvite } from "@/actions/admin/dealer-onboarding";

const campaign = {
  id: "campaign-1",
  key: "launch-pro",
  startsAt: new Date("2026-10-01T08:00:00.000Z"),
  endsAt: new Date("2027-01-01T09:00:00.000Z"),
  lockedAt: null,
};

const dealer = {
  id: "cldealerxxxxxxxxxxxxxxxxx",
  name: "Athol Garage",
  isAdminPreview: false,
  userId: "cluserxxxxxxxxxxxxxxxxxxx",
  user: {
    id: "cluserxxxxxxxxxxxxxxxxxxx",
    email: "atholgarage@itrader.im.preview",
    authUserId: "auth-1",
    role: "DEALER",
    disabledAt: null,
    deletedAt: null,
  },
  subscriptions: [],
};

describe("sendDealerOnboardingInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    mockDb.dealerPromotionCampaign.findUnique.mockResolvedValue(campaign);
    mockDb.dealerPromotionCampaign.updateMany.mockResolvedValue({ count: 1 });
    mockDb.dealerOnboardingInvite.count.mockResolvedValue(0);
    mockDb.dealerProfile.findUnique.mockResolvedValue(dealer);
    mockDb.user.findFirst.mockResolvedValue(null);
    findAuthUserMock.mockResolvedValue(null);
    mockDb.dealerOnboardingInvite.findFirst.mockResolvedValue(null);
    mockDb.dealerOnboardingInvite.create.mockImplementation(async ({ data }) => ({
      id: "clinvitexxxxxxxxxxxxxxxxx",
      ...data,
    }));
    mockDb.dealerOnboardingInvite.update.mockResolvedValue({});
    mockDb.dealerOnboardingInviteEvent.create.mockResolvedValue({});
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<void>) =>
      callback(mockDb),
    );
  });

  it("rejects a caller who is not an administrator", async () => {
    requireRoleMock.mockRejectedValue(new Error("Insufficient permissions"));
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).rejects.toThrow("Insufficient permissions");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not report an invitation as sent when email delivery is unavailable", async () => {
    sendMock.mockRejectedValue(new Error("Email delivery is not configured."));
    const result = await sendDealerOnboardingInvite({
      dealerId: dealer.id,
      recipientEmail: "owner@athol.im",
    });
    expect(result).toEqual({
      error: "The invitation email was not sent. No acceptance has been recorded.",
    });
    expect(mockDb.dealerOnboardingInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SEND_FAILED" }),
      }),
    );
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });

  it("stores a token hash and sends one claim link for a new owner email", async () => {
    sendMock.mockResolvedValue({ id: "message-1" });
    const result = await sendDealerOnboardingInvite({
      dealerId: dealer.id,
      recipientEmail: "Owner@Athol.im",
    });
    expect(result).toEqual({ data: { inviteId: "clinvitexxxxxxxxxxxxxxxxx", status: "SENT" } });
    const created = mockDb.dealerOnboardingInvite.create.mock.calls[0][0].data;
    const claimUrl = sendMock.mock.calls[0][0].text as string;
    const token = new URL(claimUrl.match(/https:\/\/itrader\.im\S+/)?.[0] ?? "").searchParams.get("token");
    expect(token).toBeTruthy();
    expect(created.tokenHash).not.toBe(token);
    expect(created.recipientEmailNorm).toBe("owner@athol.im");
    expect(created.originalEmail).toBe("atholgarage@itrader.im.preview");
  });

  it("rejects an email already used by another account", async () => {
    findAuthUserMock.mockResolvedValue({ id: "other-auth", email: "owner@athol.im" });
    const result = await sendDealerOnboardingInvite({
      dealerId: dealer.id,
      recipientEmail: "owner@athol.im",
    });
    expect(result).toEqual({ error: "That email address is already used by another account." });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
