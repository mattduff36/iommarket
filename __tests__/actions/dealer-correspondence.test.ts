import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DealerCorrespondenceCategory } from "@/lib/dealers/correspondence";
import { hashCorrespondenceToken } from "@/lib/dealers/correspondence-token";

const {
  requireAcceptedAuthMock,
  hasOperationalDealerAccessMock,
  checkRateLimitMock,
  sendVerificationMock,
  reportHandledExceptionMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAcceptedAuthMock: vi.fn(),
  hasOperationalDealerAccessMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  sendVerificationMock: vi.fn(),
  reportHandledExceptionMock: vi.fn(),
  mockDb: {
    dealerCorrespondenceSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  hasOperationalDealerAccess: hasOperationalDealerAccessMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/lib/email/dealer-correspondence", () => ({
  sendDealerCorrespondenceVerificationEmail: sendVerificationMock,
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: reportHandledExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  disableDealerCorrespondence,
  resendDealerCorrespondenceVerification,
  saveDealerCorrespondenceSettings,
  verifyDealerCorrespondenceEmail,
} from "@/actions/dealer/correspondence";

const dealer = {
  id: "dealer-user",
  role: "DEALER" as const,
  email: "owner@dealer.example",
  dealerProfile: { id: "dealer-1", name: "Isle Cars" },
};

const preferences: {
  email: string;
  categories: DealerCorrespondenceCategory[];
  copyAssignedToPrimary: boolean;
} = {
  email: "sales@dealer.example",
  categories: ["BUYER_ENQUIRIES", "REVIEWS"],
  copyAssignedToPrimary: false,
};

function writtenRecord() {
  return mockDb.dealerCorrespondenceSettings.upsert.mock.calls.at(-1)?.[0].create;
}

describe("dealer correspondence actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedAuthMock.mockResolvedValue(dealer);
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 1,
      resetAt: Date.now() + 1000,
      unavailable: false,
    });
    sendVerificationMock.mockResolvedValue(undefined);
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue(null);
    mockDb.dealerCorrespondenceSettings.upsert.mockResolvedValue({});
    mockDb.dealerCorrespondenceSettings.deleteMany.mockResolvedValue({ count: 1 });
    mockDb.dealerCorrespondenceSettings.updateMany.mockResolvedValue({ count: 1 });
  });

  it("rejects a user without dealer access before writing", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      ...dealer,
      role: "USER",
      dealerProfile: null,
    });

    await expect(saveDealerCorrespondenceSettings({ ...preferences })).resolves.toEqual({
      error: "Not authorized to update correspondence settings",
    });
    expect(mockDb.dealerCorrespondenceSettings.upsert).not.toHaveBeenCalled();
  });

  it("rejects a dealer without active access", async () => {
    hasOperationalDealerAccessMock.mockResolvedValue(false);

    await expect(saveDealerCorrespondenceSettings({ ...preferences })).resolves.toEqual({
      error: "Active dealer access is required to update correspondence settings",
    });
    expect(mockDb.dealerCorrespondenceSettings.upsert).not.toHaveBeenCalled();
  });

  it("rejects the login address and an invalid address", async () => {
    await expect(
      saveDealerCorrespondenceSettings({
        ...preferences,
        email: " Owner@Dealer.example ",
      }),
    ).resolves.toEqual({
      error: {
        email: ["Choose an email address that is different from the one you use to sign in."],
      },
    });
    await expect(
      saveDealerCorrespondenceSettings({ ...preferences, email: "not-an-email" }),
    ).resolves.toEqual({
      error: { email: ["Enter a valid email, for example name@example.com."] },
    });
    expect(sendVerificationMock).not.toHaveBeenCalled();
  });

  it("stores a hashed one-time link and sends it to the normalized address", async () => {
    const result = await saveDealerCorrespondenceSettings({
      ...preferences,
      email: " Sales@Dealer.example ",
      categories: ["REVIEWS", "BUYER_ENQUIRIES"],
    });

    expect(result).toEqual({
      data: { status: "pending", email: "sales@dealer.example", emailSent: true },
    });
    const record = writtenRecord();
    const token = sendVerificationMock.mock.calls[0][0].token as string;
    expect(record.pendingEmail).toBe("sales@dealer.example");
    expect(record.verificationTokenHash).toBe(hashCorrespondenceToken(token));
    expect(record.verificationTokenHash).not.toBe(token);
    expect(record.categories).toEqual(["BUYER_ENQUIRIES", "REVIEWS"]);
    expect(record.copyAssignedToPrimary).toBe(false);
    expect(record.verificationExpiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(record.verificationExpiresAt.getTime()).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
    expect(sendVerificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sales@dealer.example",
        dealerName: "Isle Cars",
      }),
    );
  });

  it("keeps the verified address in service while a replacement is pending", async () => {
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: "accounts@dealer.example",
      verifiedAt: new Date("2026-09-01T00:00:00Z"),
      pendingEmail: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      categories: [],
      copyAssignedToPrimary: false,
    });

    await saveDealerCorrespondenceSettings(preferences);

    expect(writtenRecord().verifiedEmail).toBe("accounts@dealer.example");
    expect(writtenRecord().pendingEmail).toBe("sales@dealer.example");
  });

  it("updates preferences without sending when the verified address is unchanged", async () => {
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: "sales@dealer.example",
      verifiedAt: new Date("2026-09-01T00:00:00Z"),
      pendingEmail: "new@dealer.example",
      verificationTokenHash: "a".repeat(64),
      verificationExpiresAt: new Date(Date.now() + 60_000),
      categories: [],
      copyAssignedToPrimary: false,
    });

    await expect(saveDealerCorrespondenceSettings(preferences)).resolves.toEqual({
      data: { status: "verified", email: "sales@dealer.example", emailSent: false },
    });
    expect(sendVerificationMock).not.toHaveBeenCalled();
    expect(writtenRecord().pendingEmail).toBeNull();
    expect(writtenRecord().verificationTokenHash).toBeNull();
  });

  it("restores the previous settings when confirmation email delivery fails", async () => {
    const existing = {
      verifiedEmail: "accounts@dealer.example",
      verifiedAt: new Date("2026-09-01T00:00:00Z"),
      pendingEmail: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      categories: ["SUBSCRIPTION"],
      copyAssignedToPrimary: true,
    };
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue(existing);
    sendVerificationMock.mockRejectedValue(new Error("delivery failed"));

    await expect(saveDealerCorrespondenceSettings(preferences)).resolves.toEqual({
      error:
        "We could not send the confirmation email. Your previous correspondence settings are unchanged.",
    });
    expect(mockDb.dealerCorrespondenceSettings.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.dealerCorrespondenceSettings.upsert.mock.calls[1][0].update).toEqual(existing);
  });

  it("removes an unsent new address when delivery fails", async () => {
    sendVerificationMock.mockRejectedValue(new Error("delivery failed"));

    await expect(saveDealerCorrespondenceSettings(preferences)).resolves.toMatchObject({
      error: expect.stringContaining("previous correspondence settings"),
    });
    expect(mockDb.dealerCorrespondenceSettings.deleteMany).toHaveBeenCalledWith({
      where: { dealerId: "dealer-1" },
    });
  });

  it("rate limits resends and refuses to resend when nothing is pending", async () => {
    checkRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 1000,
      unavailable: false,
    });

    await expect(resendDealerCorrespondenceVerification()).resolves.toEqual({
      error: "Too many attempts. Wait a few minutes and try again.",
    });
    expect(sendVerificationMock).not.toHaveBeenCalled();

    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 1,
      resetAt: Date.now() + 1000,
      unavailable: false,
    });
    await expect(resendDealerCorrespondenceVerification()).resolves.toEqual({
      error: "There is no correspondence email waiting to be confirmed.",
    });
  });

  it("replaces the pending link when a confirmation is resent", async () => {
    const oldHash = hashCorrespondenceToken("old-token-value-with-enough-length");
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: null,
      verifiedAt: null,
      pendingEmail: "sales@dealer.example",
      verificationTokenHash: oldHash,
      verificationExpiresAt: new Date(Date.now() + 60_000),
      categories: ["BUYER_ENQUIRIES"],
      copyAssignedToPrimary: false,
    });

    await resendDealerCorrespondenceVerification();

    const token = sendVerificationMock.mock.calls[0][0].token as string;
    expect(writtenRecord().verificationTokenHash).toBe(hashCorrespondenceToken(token));
    expect(writtenRecord().verificationTokenHash).not.toBe(oldHash);
  });

  it("clears routing immediately when the second address is turned off", async () => {
    await expect(disableDealerCorrespondence()).resolves.toEqual({
      data: { status: "disabled" },
    });
    expect(mockDb.dealerCorrespondenceSettings.deleteMany).toHaveBeenCalledWith({
      where: { dealerId: "dealer-1" },
    });
    expect(sendVerificationMock).not.toHaveBeenCalled();
  });

  it("confirms a pending address once and rejects the used link", async () => {
    const token = "a".repeat(43);
    const tokenHash = hashCorrespondenceToken(token);
    const pending = {
      id: "settings-1",
      pendingEmail: "sales@dealer.example",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: new Date(Date.now() + 60_000),
      dealer: { user: { email: "owner@dealer.example" } },
    };
    mockDb.dealerCorrespondenceSettings.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);

    await expect(verifyDealerCorrespondenceEmail({ token })).resolves.toEqual({
      data: { verifiedEmail: "sales@dealer.example" },
    });
    expect(mockDb.dealerCorrespondenceSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationTokenHash: tokenHash,
          pendingEmail: "sales@dealer.example",
        }),
        data: expect.objectContaining({
          verifiedEmail: "sales@dealer.example",
          pendingEmail: null,
          verificationTokenHash: null,
        }),
      }),
    );

    await expect(verifyDealerCorrespondenceEmail({ token })).resolves.toEqual({
      error: "This confirmation link is not valid.",
    });
  });

  it("does not confirm an expired link", async () => {
    const token = "b".repeat(43);
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      id: "settings-1",
      pendingEmail: "sales@dealer.example",
      verificationTokenHash: hashCorrespondenceToken(token),
      verificationExpiresAt: new Date(Date.now() - 1000),
      dealer: { user: { email: "owner@dealer.example" } },
    });

    await expect(verifyDealerCorrespondenceEmail({ token })).resolves.toEqual({
      error: "This confirmation link has expired. Send a new one from the dealer dashboard.",
    });
    expect(mockDb.dealerCorrespondenceSettings.updateMany).not.toHaveBeenCalled();
  });

  it("invalidates a pending address that now matches the login email", async () => {
    const token = "c".repeat(43);
    const tokenHash = hashCorrespondenceToken(token);
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      id: "settings-1",
      pendingEmail: "owner@dealer.example",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: new Date(Date.now() + 60_000),
      dealer: { user: { email: "owner@dealer.example" } },
    });

    await expect(verifyDealerCorrespondenceEmail({ token })).resolves.toEqual({
      error:
        "This address matches the login email. Choose a different correspondence address from the dealer dashboard.",
    });
    expect(mockDb.dealerCorrespondenceSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "settings-1", verificationTokenHash: tokenHash },
      data: {
        pendingEmail: null,
        verificationTokenHash: null,
        verificationExpiresAt: null,
      },
    });
  });
});
