import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  checkRateLimitMock,
  mockDb,
  sendMock,
  findAuthUserMock,
  logAdminActionMock,
  originMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  sendMock: vi.fn(),
  findAuthUserMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  originMock: vi.fn(() => new URL("https://itrader.im")),
  mockDb: {
    dealerPromotionCampaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    dealerPreviewPack: { findMany: vi.fn() },
    dealerProfile: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    dealerOnboardingInvite: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    dealerOnboardingInviteEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/email/send-strict", () => ({ sendStrictResendEmail: sendMock }));
vi.mock("@/lib/dealers/onboarding/auth-admin", () => ({
  findAuthUserByEmail: findAuthUserMock,
}));
vi.mock("@/lib/dealers/onboarding/deployment-origin", () => ({
  resolveOnboardingOrigin: () => originMock(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendDealerOnboardingInvite } from "@/actions/admin/dealer-onboarding";
import { LAUNCH_PROMOTION_TIMEZONE } from "@/lib/dealers/onboarding/campaign-window";
import { ONBOARDING_PRO_ENDS_AT } from "@/lib/dealers/onboarding/grant-plan";

const campaign = {
  id: "campaign-1",
  key: "launch-pro",
  timezone: LAUNCH_PROMOTION_TIMEZONE,
  startsAt: new Date("2026-10-01T08:00:00.000Z"),
  endsAt: ONBOARDING_PRO_ENDS_AT,
  tier: "PRO" as const,
  lockedAt: null,
  createdByAdminId: "cladminxxxxxxxxxxxxxxxxxx",
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
    vi.stubEnv("VERCEL_ENV", "preview");
    checkRateLimitMock.mockResolvedValue({ allowed: true });
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    originMock.mockReset();
    originMock.mockImplementation(() => new URL("https://itrader.im"));
    mockDb.dealerPromotionCampaign.findUnique.mockResolvedValue(campaign);
    mockDb.dealerPromotionCampaign.updateMany.mockResolvedValue({ count: 1 });
    mockDb.dealerPreviewPack.findMany.mockResolvedValue([
      { dealerKey: "athol-garage" },
    ]);
    mockDb.dealerOnboardingInvite.count.mockResolvedValue(0);
    mockDb.dealerProfile.findUnique.mockResolvedValue(dealer);
    mockDb.user.findFirst.mockResolvedValue(null);
    findAuthUserMock.mockImplementation(async (email: string) => {
      if (email.toLowerCase() === dealer.user.email) {
        return { id: dealer.user.authUserId, email: dealer.user.email };
      }
      return null;
    });
    mockDb.dealerOnboardingInvite.findFirst.mockResolvedValue(null);
    mockDb.dealerOnboardingInvite.create.mockImplementation(
      async ({ data }) => ({
        id: "clinvitexxxxxxxxxxxxxxxxx",
        ...data,
      }),
    );
    mockDb.dealerOnboardingInvite.update.mockResolvedValue({});
    mockDb.dealerOnboardingInviteEvent.create.mockResolvedValue({});
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => Promise<void>) =>
        callback(mockDb),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      error:
        "The invitation email was not sent. No acceptance has been recorded.",
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
    expect(result).toEqual({
      data: { inviteId: "clinvitexxxxxxxxxxxxxxxxx", status: "SENT" },
    });
    const created = mockDb.dealerOnboardingInvite.create.mock.calls[0][0].data;
    const claimUrl = sendMock.mock.calls[0][0].text as string;
    const token = new URL(
      claimUrl.match(/https:\/\/itrader\.im\S+/)?.[0] ?? "",
    ).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(created.tokenHash).not.toBe(token);
    expect(created.recipientEmailNorm).toBe("owner@athol.im");
    expect(created.originalEmail).toBe("atholgarage@itrader.im.preview");
    expect(created.campaignEndsAt).toEqual(ONBOARDING_PRO_ENDS_AT);
    expect(sendMock.mock.calls[0][0].text).toContain("31 December 2026");
    expect(sendMock.mock.calls[0][0].headers).toEqual({
      "X-Entity-Ref-ID": expect.stringMatching(
        /^dealer-onboarding-clinvite[a-z0-9]+-\d+$/,
      ),
    });
  });

  it("emails the preview deployment that created the invitation", async () => {
    originMock.mockReturnValue(
      new URL("https://iommarket-git-preview.vercel.app"),
    );
    sendMock.mockResolvedValue({ id: "message-1" });
    await sendDealerOnboardingInvite({
      dealerId: dealer.id,
      recipientEmail: "owner@athol.im",
    });
    const claimUrl = sendMock.mock.calls[0][0].text as string;
    expect(claimUrl).toContain(
      "https://iommarket-git-preview.vercel.app/dealer/onboarding/claim?token=",
    );
    expect(claimUrl).not.toContain(
      "https://itrader.im/dealer/onboarding/claim",
    );
  });

  it("rejects sample, unmatched, and synthetic dealers before sending email", async () => {
    mockDb.dealerPreviewPack.findMany.mockResolvedValue([]);
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({ error: "Choose an active dealer account." });

    mockDb.dealerPreviewPack.findMany.mockResolvedValue([
      { dealerKey: "athol-garage" },
    ]);
    mockDb.dealerProfile.findUnique.mockResolvedValue({
      ...dealer,
      user: {
        ...dealer.user,
        email: "info@manxmotors.im",
        authUserId: "00000000-0000-0000-0000-000000000101",
      },
    });
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({ error: "Choose an active dealer account." });
    expect(sendMock).not.toHaveBeenCalled();
    expect(mockDb.dealerOnboardingInvite.create).not.toHaveBeenCalled();
  });

  it("rejects a founding account whose authentication identity does not match", async () => {
    findAuthUserMock.mockImplementation(async (email: string) => {
      if (email.toLowerCase() === dealer.user.email)
        return { id: "other-auth", email };
      return null;
    });
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({ error: "This dealer account cannot be invited." });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("keeps real founding dealers eligible in production without Preview Packs", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mockDb.dealerPreviewPack.findMany.mockResolvedValue([]);
    sendMock.mockResolvedValue({ id: "message-1" });

    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({
      data: { inviteId: "clinvitexxxxxxxxxxxxxxxxx", status: "SENT" },
    });
  });

  it("requires immutable Auth provenance for a generic Preview test dealer", async () => {
    const previewDealer = {
      ...dealer,
      name: "Preview Dealer 2",
      user: {
        ...dealer.user,
        email: "previewdealer2@itrader.im.preview",
      },
    };
    mockDb.dealerProfile.findUnique.mockResolvedValue(previewDealer);
    findAuthUserMock.mockImplementation(async (email: string) => {
      if (email.toLowerCase() !== previewDealer.user.email) return null;
      return {
        id: previewDealer.user.authUserId,
        email: previewDealer.user.email,
        appMetadata: {},
      };
    });
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({ error: "This dealer account cannot be invited." });

    findAuthUserMock.mockResolvedValue({
      id: previewDealer.user.authUserId,
      email: previewDealer.user.email,
      appMetadata: {
        dealerOnboardingTest: {
          version: 1,
          environment: "preview",
          key: "preview-dealer-2",
        },
      },
    });
    sendMock.mockResolvedValue({ id: "message-1" });
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({
      data: { inviteId: "clinvitexxxxxxxxxxxxxxxxx", status: "SENT" },
    });
  });

  it("rejects a dealer with a paid subscription", async () => {
    mockDb.dealerProfile.findUnique.mockResolvedValue({
      ...dealer,
      subscriptions: [
        {
          source: "PAYMENT",
          status: "ACTIVE",
          grantStartsAt: null,
          grantEndsAt: null,
          revokedAt: null,
          currentPeriodEnd: new Date("2027-06-01T00:00:00.000Z"),
        },
      ],
    });
    await expect(
      sendDealerOnboardingInvite({
        dealerId: dealer.id,
        recipientEmail: "owner@athol.im",
      }),
    ).resolves.toEqual({
      error: "This dealer has a paid subscription, so onboarding was not sent.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects an email already used by another account", async () => {
    findAuthUserMock.mockResolvedValue({
      id: "other-auth",
      email: "owner@athol.im",
    });
    const result = await sendDealerOnboardingInvite({
      dealerId: dealer.id,
      recipientEmail: "owner@athol.im",
    });
    expect(result).toEqual({
      error: "That email address is already used by another account.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
