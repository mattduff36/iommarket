/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendResendEmail: vi.fn(),
  reportHandledException: vi.fn(),
}));

vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/email/client")>();
  return {
    ...actual,
    sendResendEmail: mocks.sendResendEmail,
  };
});

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: mocks.reportHandledException,
}));

const signup = {
  userId: "auth-user-1",
  email: "member@example.com",
  name: "Test <Member>",
  source: "credential" as const,
  createdAt: new Date("2026-10-02T09:30:00.000Z"),
};

describe("new signup admin notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "iTrader <no-reply@itrader.im>");
    vi.stubEnv(
      "RESEND_SIGNUPS_TO_EMAIL",
      " Admin@example.com,invalid,admin@example.com ",
    );
    vi.stubEnv("RESEND_REPORTS_TO_EMAIL", "fallback@example.com");
    mocks.sendResendEmail.mockResolvedValue(undefined);
    mocks.reportHandledException.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends sanitized signup details with a stable idempotency key", async () => {
    const { sendNewSignupAdminNotificationEmail } =
      await import("@/lib/email/signup-notifications");

    await sendNewSignupAdminNotificationEmail(signup);

    expect(mocks.sendResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["admin@example.com"],
        subject: "New iTrader User Signup",
        idempotencyKey: "new-user-signup/auth-user-1",
      }),
    );
    const message = mocks.sendResendEmail.mock.calls[0][0];
    expect(message.text).toContain("Test <Member>");
    expect(message.html).toContain("Test &lt;Member&gt;");
    expect(message.html).not.toContain("Test <Member>");
    expect(JSON.stringify(message)).not.toMatch(/password|secret/i);
  });

  it("uses the existing reports inbox when no signup inbox is set", async () => {
    vi.stubEnv("RESEND_SIGNUPS_TO_EMAIL", "");
    const { sendNewSignupAdminNotificationEmail } =
      await import("@/lib/email/signup-notifications");

    await sendNewSignupAdminNotificationEmail(signup);

    expect(mocks.sendResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["fallback@example.com"] }),
    );
  });

  it("logs delivery failures without rejecting the signup notification attempt", async () => {
    mocks.sendResendEmail.mockRejectedValueOnce(new Error("provider unavailable"));
    const { notifyAdminOfNewSignup } =
      await import("@/lib/email/signup-notifications");

    await expect(notifyAdminOfNewSignup(signup)).resolves.toBeUndefined();

    expect(mocks.reportHandledException).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notifyAdminOfNewSignup",
        userId: "auth-user-1",
        userEmail: "member@example.com",
      }),
    );
  });

  it("logs missing recipient configuration without failing signup", async () => {
    vi.stubEnv("RESEND_SIGNUPS_TO_EMAIL", "");
    vi.stubEnv("RESEND_REPORTS_TO_EMAIL", "");
    const { notifyAdminOfNewSignup } =
      await import("@/lib/email/signup-notifications");

    await expect(notifyAdminOfNewSignup(signup)).resolves.toBeUndefined();

    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(mocks.reportHandledException).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "Signup notification recipient is not configured.",
        }),
      }),
    );
  });
});
