/* @vitest-environment node */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sendSignupConfirmationEmail = vi.fn();
const sendPasswordResetEmail = vi.fn();
const sendEmailChangeEmail = vi.fn();
const sendMagicLinkEmail = vi.fn();
const sendInviteEmail = vi.fn();
const reportHandledException = vi.fn();
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  sendSignupConfirmationEmail,
  sendPasswordResetEmail,
  sendEmailChangeEmail,
  sendMagicLinkEmail,
  sendInviteEmail,
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      verifyOtp,
      exchangeCodeForSession,
    },
  }),
}));

const secretBytes = Buffer.from("0123456789abcdef0123456789abcdef");
const hookSecret = `v1,whsec_${secretBytes.toString("base64")}`;

function signedRequest(payload: string, signatureOverride?: string): NextRequest {
  const messageId = "msg_auth_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature =
    signatureOverride ??
    `v1,${createHmac("sha256", secretBytes)
      .update(`${messageId}.${timestamp}.${payload}`)
      .digest("base64")}`;

  return new NextRequest("https://itrader.im/api/auth/send-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": messageId,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    },
    body: payload,
  });
}

function signupPayload(redirectTo = "https://itrader.im/auth/callback?next=%2Faccount"): string {
  return JSON.stringify({
    user: { email: "seller@example.com" },
    email_data: {
      token_hash: "token_hash",
      email_action_type: "signup",
      redirect_to: redirectTo,
    },
  });
}

describe("Supabase auth email hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.im");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SUPABASE_AUTH_HOOK_SECRET", hookSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the signing secret is unavailable", async () => {
    vi.stubEnv("SUPABASE_AUTH_HOOK_SECRET", "");
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Auth email hook unavailable",
    });
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the signing secret is malformed", async () => {
    vi.stubEnv(
      "SUPABASE_AUTH_HOOK_SECRET",
      "v1,whsec_not-base64-but-long-enough-****************",
    );
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(503);
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing signature before dispatch", async () => {
    const { POST } = await import("@/app/api/auth/send-email/route");
    const request = new NextRequest("https://itrader.im/api/auth/send-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: signupPayload(),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before dispatch", async () => {
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload(), "v1,invalid"));

    expect(response.status).toBe(401);
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("dispatches one signed email with a same-origin verification URL", async () => {
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(200);
    expect(sendSignupConfirmationEmail).toHaveBeenCalledTimes(1);
    const verifyUrl = new URL(
      sendSignupConfirmationEmail.mock.calls[0][0].verifyUrl as string,
    );
    expect(verifyUrl.origin).toBe("https://itrader.im");
    expect(verifyUrl.pathname).toBe("/auth/callback");
    expect(verifyUrl.searchParams.get("next")).toBe("/account");
  });

  it("uses the Vercel production host when the app URL is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "marketplace.example");
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(200);
    const verifyUrl = new URL(
      sendSignupConfirmationEmail.mock.calls[0][0].verifyUrl as string,
    );
    expect(verifyUrl.origin).toBe("https://marketplace.example");
  });

  it("fails closed when no canonical app origin is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(503);
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the configured app origin is malformed", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not an absolute URL");
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(503);
    expect(sendSignupConfirmationEmail).not.toHaveBeenCalled();
  });

  it("does not trust an external redirect origin or unsafe next path", async () => {
    const { POST } = await import("@/app/api/auth/send-email/route");
    const payload = signupPayload(
      "https://attacker.example/auth/callback?next=%2F%5Cattacker.example",
    );

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    const verifyUrl = new URL(
      sendSignupConfirmationEmail.mock.calls[0][0].verifyUrl as string,
    );
    expect(verifyUrl.origin).toBe("https://itrader.im");
    expect(verifyUrl.searchParams.get("next")).toBe("/");
  });

  it("returns a generic provider error while retaining internal reporting", async () => {
    sendSignupConfirmationEmail.mockRejectedValueOnce(
      new Error("provider account detail"),
    );
    const { POST } = await import("@/app/api/auth/send-email/route");

    const response = await POST(signedRequest(signupPayload()));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to send auth email",
    });
    expect(reportHandledException).toHaveBeenCalledTimes(1);
  });
});

describe("auth callback redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyOtp.mockResolvedValue({ error: null });
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("preserves a safe root-relative next path", async () => {
    const { GET } = await import("@/app/(public)/auth/callback/route");
    const response = await GET(
      new Request(
        "https://itrader.im/auth/callback?token_hash=token&type=signup&next=%2Faccount%3Ftab%3Dsecurity",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://itrader.im/account?tab=security",
    );
  });

  it("rejects backslash-based origin escapes", async () => {
    const { GET } = await import("@/app/(public)/auth/callback/route");
    const response = await GET(
      new Request(
        "https://itrader.im/auth/callback?token_hash=token&type=signup&next=%2F%5Cattacker.example",
      ),
    );

    expect(response.headers.get("location")).toBe("https://itrader.im/");
  });

  it("rejects control characters in the next path", async () => {
    const { GET } = await import("@/app/(public)/auth/callback/route");
    const response = await GET(
      new Request(
        "https://itrader.im/auth/callback?token_hash=token&type=signup&next=%2Faccount%0D%0ALocation%3A%20https%3A%2F%2Fattacker.example",
      ),
    );

    expect(response.headers.get("location")).toBe("https://itrader.im/");
  });
});
