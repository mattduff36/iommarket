/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const admin = {
    auth: {
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn(),
        updateUserById: vi.fn(),
      },
    },
  };
  return {
    admin,
    createSupabaseAdminClient: vi.fn(() => admin),
    isSupabaseAuthConfigured: vi.fn(() => true),
    sendSignupConfirmationEmail: vi.fn(),
    notifyAdminOfNewSignup: vi.fn(),
    reportHandledException: vi.fn(),
    checkSignupRateLimit: vi.fn(),
    headers: vi.fn(),
    signInWithPassword: vi.fn(),
    createClient: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/lib/auth/supabase-config", () => ({
  isSupabaseAuthConfigured: mocks.isSupabaseAuthConfigured,
}));

vi.mock("@/lib/email/resend", () => ({
  sendSignupConfirmationEmail: mocks.sendSignupConfirmationEmail,
}));

vi.mock("@/lib/email/signup-notifications", () => ({
  notifyAdminOfNewSignup: mocks.notifyAdminOfNewSignup,
}));

vi.mock("@/lib/policy/acceptance", () => ({
  buildSignupAcceptanceReceipt: () => ({ version: "test-policy" }),
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: mocks.reportHandledException,
}));

vi.mock("@/lib/auth/signup-rate-limit", () => ({
  checkSignupRateLimit: mocks.checkSignupRateLimit,
}));

const validInput = {
  email: "member@example.com",
  password: "strong-password-123",
  name: "Test Member",
  nextPath: "/dealer/subscribe?tier=PRO",
  ageAttested: true,
  policiesAccepted: true,
};

describe("signUpWithPolicyAcceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://preview.itrader.im");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://preview-project.supabase.co",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "preview-anon-key");
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "iTrader <no-reply@itrader.im>");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "1");
    vi.stubEnv("PREVIEW_LAUNCH_GATE_QA", "");
    mocks.createClient.mockReturnValue({
      auth: { signInWithPassword: mocks.signInWithPassword },
    });
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    mocks.headers.mockResolvedValue(
      new Headers({ "x-forwarded-for": "203.0.113.10" }),
    );
    mocks.checkSignupRateLimit.mockResolvedValue({ allowed: true });
    mocks.admin.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: "auth-user-id" } },
      error: null,
    });
    mocks.admin.auth.admin.generateLink.mockResolvedValue({
      data: {
        user: {
          id: "auth-user-id",
          app_metadata: { provider: "email" },
          user_metadata: { locale: "en-GB" },
        },
        properties: {
          hashed_token: "hashed-signup-token",
          verification_type: "signup",
        },
      },
      error: null,
    });
    mocks.admin.auth.admin.updateUserById.mockResolvedValue({ error: null });
    mocks.sendSignupConfirmationEmail.mockResolvedValue(undefined);
    mocks.notifyAdminOfNewSignup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("generates and sends a branded confirmation link for the preview origin", async () => {
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      data: { email: "member@example.com" },
    });

    expect(mocks.admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
      email_confirm: false,
      user_metadata: { full_name: "Test Member" },
      app_metadata: {
        policy_acceptance: { version: "test-policy" },
      },
    });
    expect(mocks.admin.auth.admin.generateLink).toHaveBeenCalledWith({
      type: "signup",
      email: "member@example.com",
      password: "strong-password-123",
      options: {
        data: { full_name: "Test Member" },
        redirectTo:
          "https://preview.itrader.im/auth/callback?next=%2Fdealer%2Fsubscribe%3Ftier%3DPRO",
      },
    });
    expect(mocks.admin.auth.admin.updateUserById).toHaveBeenCalledWith(
      "auth-user-id",
      {
        app_metadata: {
          provider: "email",
          policy_acceptance: { version: "test-policy" },
        },
      },
    );
    expect(mocks.sendSignupConfirmationEmail).toHaveBeenCalledWith({
      to: "member@example.com",
      verifyUrl:
        "https://preview.itrader.im/auth/callback?token_hash=hashed-signup-token&type=signup&next=%2Fdealer%2Fsubscribe%3Ftier%3DPRO",
    });
    expect(mocks.notifyAdminOfNewSignup).toHaveBeenCalledWith({
      userId: "auth-user-id",
      email: "member@example.com",
      name: "Test Member",
      source: "credential",
      createdAt: expect.any(Date),
    });
  });

  it("reports branded email delivery failure without deleting the auth account", async () => {
    mocks.sendSignupConfirmationEmail.mockRejectedValueOnce(
      new Error("email delivery failed"),
    );
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      error: "We could not create your account. Please try again shortly.",
    });

    expect(mocks.reportHandledException).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAdminOfNewSignup).toHaveBeenCalledTimes(1);
  });

  it("returns the existing-account message without sending another email", async () => {
    mocks.admin.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      error: "An account with this email already exists. Please sign in instead.",
    });

    expect(mocks.sendSignupConfirmationEmail).not.toHaveBeenCalled();
    expect(mocks.notifyAdminOfNewSignup).not.toHaveBeenCalled();
  });

  it("fails before creating an account when branded email is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      error: "Account sign-up is temporarily unavailable. Please try again shortly.",
    });

    expect(mocks.admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendSignupConfirmationEmail).not.toHaveBeenCalled();
    expect(mocks.notifyAdminOfNewSignup).not.toHaveBeenCalled();
  });

  it("resends confirmation only when an unconfirmed account password matches", async () => {
    mocks.admin.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      data: { email: "member@example.com" },
    });

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
    });
    expect(mocks.admin.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    expect(mocks.sendSignupConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAdminOfNewSignup).not.toHaveBeenCalled();
  });

  it("does not issue a link for an unconfirmed account with a different password", async () => {
    mocks.admin.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      error: "An account with this email already exists. Please sign in instead.",
    });

    expect(mocks.admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("issues only the winning link when concurrent passwords differ", async () => {
    mocks.admin.auth.admin.createUser
      .mockResolvedValueOnce({
        data: { user: { id: "auth-user-id" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: "User already registered" },
      });
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    const [first, second] = await Promise.all([
      signUpWithPolicyAcceptance(validInput),
      signUpWithPolicyAcceptance({
        ...validInput,
        password: "different-password-456",
      }),
    ]);

    expect(first).toEqual({ data: { email: "member@example.com" } });
    expect(second).toEqual({
      error: "An account with this email already exists. Please sign in instead.",
    });
    expect(mocks.admin.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    expect(mocks.sendSignupConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("stops rate-limited requests before creating an account", async () => {
    mocks.checkSignupRateLimit.mockResolvedValueOnce({ allowed: false });
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(signUpWithPolicyAcceptance(validInput)).resolves.toEqual({
      error: "Too many signup attempts. Please wait a moment and try again.",
    });

    expect(mocks.admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing name", { ...validInput, name: undefined }],
    ["a blank name", { ...validInput, name: "   " }],
  ])("rejects %s before creating an auth account", async (_label, input) => {
    const { signUpWithPolicyAcceptance } = await import("@/actions/auth/sign-up");

    await expect(
      signUpWithPolicyAcceptance(
        input as unknown as Parameters<typeof signUpWithPolicyAcceptance>[0],
      ),
    ).resolves.toEqual({
      error: { name: ["Enter a name of at least 2 characters."] },
    });

    expect(mocks.admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mocks.admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });
});
