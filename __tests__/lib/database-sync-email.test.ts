import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
import { isSyntheticEmailRecipient, sendResendEmail } from "@/lib/email/client";
import { sendStrictResendEmail } from "@/lib/email/send-strict";

describe("synthetic development recipients", () => {
  it("recognizes reserved domains without blocking ordinary addresses", () => {
    expect(isSyntheticEmailRecipient("sync-123@example.invalid")).toBe(true);
    expect(isSyntheticEmailRecipient("TEST@EXAMPLE.COM ")).toBe(true);
    expect(isSyntheticEmailRecipient("person@itrader.im")).toBe(false);
  });
  it("never delivers synthetic recipients through either email helper", async () => {
    vi.stubEnv("RESEND_API_KEY", randomUUID());
    try {
      await sendResendEmail({ to: "sync@example.invalid", subject: "Test", text: "Test" });
      await expect(sendStrictResendEmail({ to: "sync@example.invalid", subject: "Test", text: "Test" })).rejects.toThrow("synthetic");
      expect(send).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
});
