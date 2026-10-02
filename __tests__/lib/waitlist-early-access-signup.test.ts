/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueEarlyAccessClaimCookie } from "@/lib/waitlist/early-access/tokens";

const SECRET = "0123456789abcdef0123456789abcdef";
const mocks = vi.hoisted(() => ({
  cookiesGet: vi.fn(),
  cookiesSet: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  createUser: vi.fn(),
  signIn: vi.fn(),
  syncUser: vi.fn(),
  checkSignupRateLimit: vi.fn(),
  notifyAdminOfNewSignup: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookiesGet, set: mocks.cookiesSet }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.8" }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    waitlistEarlyAccessRecipient: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { createUser: mocks.createUser } } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword: mocks.signIn } }),
}));

vi.mock("@/lib/auth", () => ({ syncUser: mocks.syncUser }));

vi.mock("@/lib/auth/signup-rate-limit", () => ({
  checkSignupRateLimit: mocks.checkSignupRateLimit,
}));

vi.mock("@/lib/email/signup-notifications", () => ({
  notifyAdminOfNewSignup: mocks.notifyAdminOfNewSignup,
}));

vi.mock("@/lib/auth/supabase-config", () => ({ isSupabaseAuthConfigured: () => true }));

vi.mock("@/lib/policy/acceptance", () => ({
  buildSignupAcceptanceReceipt: () => ({ version: "test-policy" }),
}));

const input = {
  email: "member@example.com",
  password: "strong-password-123",
  name: "Member",
  nextPath: "/account",
  ageAttested: true,
  policiesAccepted: true,
};

function issuedCookie() {
  return issueEarlyAccessClaimCookie({
    secret: SECRET,
    recipientId: "recipient1",
    nonce: "nonce-1",
  });
}

describe("completeInvitedSignUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEV_GATE_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "");
    vi.stubEnv("PREVIEW_LAUNCH_GATE_QA", "");
    mocks.cookiesGet.mockReturnValue({ value: issuedCookie()?.value });
    mocks.findUnique.mockResolvedValue({
      id: "recipient1",
      nonce: "nonce-1",
      deliveryStatus: "SENT",
      claimedAt: null,
      waitlistUser: { email: "member@example.com" },
      testAdmin: null,
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.checkSignupRateLimit.mockResolvedValue({ allowed: true });
    mocks.createUser.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    mocks.signIn.mockResolvedValue({ error: null });
    mocks.syncUser.mockResolvedValue({ id: "user-1" });
    mocks.notifyAdminOfNewSignup.mockResolvedValue(undefined);
  });

  it("creates a verified account, signs in, and claims the invitation once", async () => {
    const { completeInvitedSignUp } = await import("@/lib/waitlist/early-access/signup");
    await expect(completeInvitedSignUp(input, "203.0.113.8")).resolves.toEqual({
      data: { email: "member@example.com", signedIn: true },
    });
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "member@example.com",
        email_confirm: true,
        app_metadata: expect.objectContaining({ early_access: true }),
      }),
    );
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
    });
    expect(mocks.syncUser).toHaveBeenCalled();
    expect(mocks.notifyAdminOfNewSignup).toHaveBeenCalledWith({
      userId: "auth-1",
      email: "member@example.com",
      name: "Member",
      source: "early_access",
      createdAt: expect.any(Date),
    });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);

    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");
    await expect(signUpWithPolicyAcceptance(input)).resolves.toEqual({
      data: { email: "member@example.com", signedIn: true },
    });
  });

  it("rejects a different email without creating an account", async () => {
    const { completeInvitedSignUp } = await import("@/lib/waitlist/early-access/signup");
    await expect(
      completeInvitedSignUp({ ...input, email: "other@example.com" }, "203.0.113.8"),
    ).resolves.toEqual({
      error: "This invitation is locked to the email address it was sent to.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("sends an existing account to sign in and does not create another", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });
    const { completeInvitedSignUp } = await import("@/lib/waitlist/early-access/signup");
    await expect(completeInvitedSignUp(input, "203.0.113.8")).resolves.toEqual({
      error: "An account with this email already exists. Please sign in instead.",
    });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.notifyAdminOfNewSignup).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ claimedAt: expect.any(Date) }),
      }),
    );
  });

  it("does not create an account when another claim already holds the invitation", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const { completeInvitedSignUp } = await import("@/lib/waitlist/early-access/signup");
    await expect(completeInvitedSignUp(input, "203.0.113.8")).resolves.toEqual({
      error: "This invitation is already being used. Please wait a moment and try again.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("stops accepting the invitation once the launch gate opens", async () => {
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "1");
    const { completeInvitedSignUp } = await import("@/lib/waitlist/early-access/signup");
    await expect(completeInvitedSignUp(input, "203.0.113.8")).resolves.toEqual({
      error: "Use the invitation in your email to create an early-access account.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("sets a claim cookie without consuming the invitation", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    const { signEarlyAccessInvite } = await import("@/lib/waitlist/early-access/tokens");
    const proof = signEarlyAccessInvite({
      secret: SECRET,
      recipientId: "recipient1",
      nonce: "nonce-1",
    });
    const { continueEarlyAccessClaim } = await import("@/actions/early-access");
    await expect(
      continueEarlyAccessClaim({ recipientId: "recipient1", proof: proof ?? "" }),
    ).resolves.toEqual({ data: { redirect: "/sign-up" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.cookiesSet).toHaveBeenCalledWith(
      "__Host-early-access",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax" }),
    );
  });
});
