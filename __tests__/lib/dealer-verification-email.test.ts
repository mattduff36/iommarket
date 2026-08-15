import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendResendEmailMock, captureExceptionMock } = vi.hoisted(() => ({
  sendResendEmailMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/email/client", () => ({
  sendResendEmail: sendResendEmailMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

import { sendDealerVerificationEmail } from "@/lib/email/dealer-notifications";

describe("dealer verification email ALR-MAIL-003", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when Resend and monitoring both fail", async () => {
    sendResendEmailMock.mockRejectedValue(new Error("Resend threw"));
    captureExceptionMock.mockRejectedValue(new Error("monitor down"));

    await expect(
      sendDealerVerificationEmail({
        to: "dealer@example.com",
        dealerName: "Isle Cars",
        verified: true,
      }),
    ).resolves.toBeUndefined();
  });
});
