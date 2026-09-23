import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, recoveryMock, writeCookieMock } = vi.hoisted(() => ({
  mockDb: {
    dealerOnboardingInvite: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  recoveryMock: vi.fn(),
  writeCookieMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/dealers/onboarding/auth-admin", () => ({
  generateDealerRecoveryLink: (...args: unknown[]) => recoveryMock(...args),
  invalidateDealerAuthSessions: vi.fn(),
  revokeAuthUserSessions: vi.fn(),
  updateAuthUserEmail: vi.fn(),
}));
vi.mock("@/lib/dealers/onboarding/claim-cookie", () => ({
  writeOnboardingClaimCookie: (...args: unknown[]) => writeCookieMock(...args),
  readOnboardingClaimCookie: vi.fn(),
  clearOnboardingClaimCookie: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error("NEXT_REDIRECT");
    Object.assign(error, { digest: `NEXT_REDIRECT;${url}` });
    throw error;
  },
}));

import { beginDealerOnboardingClaim } from "@/actions/dealer-onboarding";
import { buildOnboardingRedirectUrl } from "@/lib/dealers/onboarding/recovery-link";
import { resolveOnboardingOrigin } from "@/lib/dealers/onboarding/deployment-origin";
import { createOnboardingToken, hashOnboardingToken } from "@/lib/dealers/onboarding/tokens";

const token = createOnboardingToken();
const invite = {
  id: "invite-1",
  tokenHash: hashOnboardingToken(token),
  status: "SENT",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  claimedAt: null,
  originalEmail: "atholgarage@itrader.im.preview",
  recipientEmailNorm: "owner@athol.im",
  targetAuthUserId: "auth-1",
};

describe("beginDealerOnboardingClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dealerOnboardingInvite.findUnique.mockResolvedValue(invite);
    mockDb.dealerOnboardingInvite.updateMany.mockResolvedValue({ count: 1 });
    recoveryMock.mockResolvedValue({
      actionLink: "https://project.supabase.co/auth/v1/verify?token=secret",
      authUserId: "auth-1",
    });
    writeCookieMock.mockResolvedValue(undefined);
  });

  it("continues a stored invitation on the current onboarding origin", async () => {
    await expect(beginDealerOnboardingClaim({ token })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(writeCookieMock).toHaveBeenCalledWith(token);
    expect(recoveryMock).toHaveBeenCalledWith({
      email: invite.originalEmail,
      redirectTo: buildOnboardingRedirectUrl(resolveOnboardingOrigin().origin),
    });
    expect(mockDb.dealerOnboardingInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CLAIMING" }),
      }),
    );
  });

  it("returns the invalid-link error when the token was never stored", async () => {
    mockDb.dealerOnboardingInvite.findUnique.mockResolvedValue(null);
    await expect(beginDealerOnboardingClaim({ token })).resolves.toEqual({
      error: "This invitation link is not valid.",
    });
    expect(recoveryMock).not.toHaveBeenCalled();
    expect(writeCookieMock).not.toHaveBeenCalled();
  });

  it("does not store the claim when recovery belongs to a different account", async () => {
    recoveryMock.mockResolvedValue({
      actionLink: "https://project.supabase.co/auth/v1/verify?token=secret",
      authUserId: "other-auth",
    });
    await expect(beginDealerOnboardingClaim({ token })).resolves.toEqual({
      error: "Unable to continue this invitation. Try the email link again.",
    });
    expect(writeCookieMock).not.toHaveBeenCalled();
  });
});
