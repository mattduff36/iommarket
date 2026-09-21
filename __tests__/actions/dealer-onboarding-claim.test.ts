import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  getUserMock,
  updateUserMock,
  signOutMock,
  getSessionMock,
  commitMock,
  markMock,
  updateAuthEmailMock,
  revokeMock,
  invalidateMock,
  rawToken,
} = vi.hoisted(() => ({
  mockDb: {
    dealerOnboardingInvite: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  getSessionMock: vi.fn(),
  commitMock: vi.fn(),
  markMock: vi.fn(),
  updateAuthEmailMock: vi.fn(),
  revokeMock: vi.fn(),
  invalidateMock: vi.fn(),
  rawToken: "claim-token-claim-token-claim-token-xyz",
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/dealers/onboarding/claim-cookie", () => ({
  readOnboardingClaimCookie: vi.fn(async () => rawToken),
  writeOnboardingClaimCookie: vi.fn(),
  clearOnboardingClaimCookie: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: getUserMock,
      updateUser: updateUserMock,
      getSession: getSessionMock,
      signOut: signOutMock,
    },
  }),
}));
vi.mock("@/lib/dealers/onboarding/activate", () => ({
  commitOnboardingClaim: commitMock,
  markOnboardingCompleted: markMock,
  OnboardingClaimError: class OnboardingClaimError extends Error {},
}));
vi.mock("@/lib/dealers/onboarding/auth-admin", () => ({
  updateAuthUserEmail: updateAuthEmailMock,
  revokeAuthUserSessions: revokeMock,
  invalidateDealerAuthSessions: invalidateMock,
  generateDealerRecoveryLink: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn() }));

import { hashOnboardingToken } from "@/lib/dealers/onboarding/tokens";
import { completeDealerOnboardingClaim } from "@/actions/dealer-onboarding";

const token = rawToken;
const invite = {
  id: "invite-1",
  tokenHash: hashOnboardingToken(token),
  status: "CLAIMING",
  targetAuthUserId: "auth-1",
  userId: "user-1",
  dealerId: "dealer-1",
  recipientEmailNorm: "owner@dealer.im",
};

describe("completeDealerOnboardingClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dealerOnboardingInvite.findUnique.mockResolvedValue(invite);
    mockDb.dealerOnboardingInvite.updateMany.mockResolvedValue({ count: 1 });
    getUserMock.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    updateUserMock.mockResolvedValue({ error: null });
    commitMock.mockResolvedValue({ kind: "finalizing" });
    updateAuthEmailMock.mockResolvedValue({ id: "auth-1", email: "owner@dealer.im" });
    markMock.mockResolvedValue({ already: false });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "access-token" } } });
    signOutMock.mockResolvedValue({ error: null });
    revokeMock.mockResolvedValue(undefined);
    invalidateMock.mockResolvedValue(undefined);
    mockDb.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
  });

  it("requires all three explicit checks", async () => {
    const result = await completeDealerOnboardingClaim({
      password: "new-password",
      confirmPassword: "new-password",
      ageAttested: true,
      accountPoliciesAccepted: true,
      dealerPoliciesAccepted: false,
    });
    expect(result.error).toBeTruthy();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("rejects a recovered session for a different account", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "other-auth" } } });
    const result = await completeDealerOnboardingClaim({
      password: "new-password",
      confirmPassword: "new-password",
      ageAttested: true,
      accountPoliciesAccepted: true,
      dealerPoliciesAccepted: true,
    });
    expect(result).toEqual({ error: "This secure link does not match the invitation." });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("keeps finalization open when the old session cannot be revoked", async () => {
    revokeMock.mockRejectedValue(new Error("Unable to finish signing out the old session."));
    const result = await completeDealerOnboardingClaim({
      password: "new-password",
      confirmPassword: "new-password",
      ageAttested: true,
      accountPoliciesAccepted: true,
      dealerPoliciesAccepted: true,
    });
    expect(result).toEqual({
      error: "We could not finish activating this account. Submit the form again.",
    });
    expect(markMock).not.toHaveBeenCalled();
  });

  it("does not finish when the browser session is still signed in", async () => {
    signOutMock.mockResolvedValue({ error: new Error("sign-out failed") });
    const result = await completeDealerOnboardingClaim({
      password: "new-password",
      confirmPassword: "new-password",
      ageAttested: true,
      accountPoliciesAccepted: true,
      dealerPoliciesAccepted: true,
    });
    expect(result).toEqual({
      error: "We could not finish activating this account. Submit the form again.",
    });
    expect(markMock).not.toHaveBeenCalled();
  });

  it("finishes email transfer and revokes the old session", async () => {
    const result = await completeDealerOnboardingClaim({
      password: "new-password",
      confirmPassword: "new-password",
      ageAttested: true,
      accountPoliciesAccepted: true,
      dealerPoliciesAccepted: true,
    });
    expect(result).toEqual({ data: { completed: true } });
    expect(updateAuthEmailMock).toHaveBeenCalledWith({
      authUserId: "auth-1",
      email: "owner@dealer.im",
    });
    expect(revokeMock).toHaveBeenCalledWith("access-token");
    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
  });
});
