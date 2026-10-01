/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  recipientFindUnique: vi.fn(),
  update: vi.fn(),
  campaignFindUnique: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  sendStrictResendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    waitlistEarlyAccessRecipient: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUnique: mocks.recipientFindUnique,
      update: mocks.update,
      groupBy: mocks.groupBy,
      count: mocks.count,
    },
    waitlistEarlyAccessCampaign: {
      findUnique: mocks.campaignFindUnique,
      update: mocks.update,
    },
  },
}));

vi.mock("@/lib/email/send-strict", () => ({
  sendStrictResendEmail: mocks.sendStrictResendEmail,
}));

describe("early-access delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "");
    vi.stubEnv("DEV_GATE_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.im");
    mocks.findMany.mockResolvedValue([{ id: "recipient-1" }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.recipientFindUnique.mockResolvedValue({
      id: "recipient-1",
      campaignId: "campaign-1",
      nonce: "nonce-1",
      attemptCount: 1,
      waitlistUser: {
        email: "member@example.com",
        deletedAt: null,
        marketingConsentAt: new Date("2026-09-01T00:00:00.000Z"),
        marketingWithdrawnAt: null,
        interests: ["BUYING_CARS"],
      },
    });
    mocks.campaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      bodyText: "You are invited.",
      status: "QUEUED",
    });
    mocks.sendStrictResendEmail.mockResolvedValue({ id: "email-1" });
    mocks.groupBy.mockResolvedValue([
      { deliveryStatus: "SENT", _count: { _all: 1 } },
    ]);
    mocks.count.mockResolvedValue(0);
    mocks.update.mockResolvedValue({});
  });

  it("does not send the audience from Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_LAUNCH_GATE_QA", "1");
    const { deliverEarlyAccessBatch } = await import("@/lib/waitlist/early-access/delivery");
    await expect(deliverEarlyAccessBatch()).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      blocked: true,
    });
    expect(mocks.sendStrictResendEmail).not.toHaveBeenCalled();
  });

  it("sends once, then skips a recipient whose consent was withdrawn", async () => {
    const { deliverEarlyAccessRecipient } = await import("@/lib/waitlist/early-access/delivery");
    await expect(deliverEarlyAccessRecipient("recipient-1")).resolves.toBe("SENT");
    expect(mocks.sendStrictResendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        headers: { "X-Entity-Ref-ID": "waitlist-ea-campaign-1-recipient-1-1" },
      }),
    );

    mocks.recipientFindUnique.mockResolvedValueOnce({
      id: "recipient-1",
      campaignId: "campaign-1",
      nonce: "nonce-1",
      attemptCount: 2,
      waitlistUser: {
        email: "member@example.com",
        deletedAt: null,
        marketingConsentAt: new Date("2026-09-01T00:00:00.000Z"),
        marketingWithdrawnAt: new Date("2026-10-01T00:00:00.000Z"),
        interests: ["BUYING_CARS"],
      },
    });
    await expect(deliverEarlyAccessRecipient("recipient-1")).resolves.toBe("SKIPPED");
    expect(mocks.sendStrictResendEmail).toHaveBeenCalledTimes(1);
  });

  it("records a failure and sends it on the next attempt", async () => {
    mocks.sendStrictResendEmail.mockRejectedValueOnce(new Error("provider down"));
    const { deliverEarlyAccessRecipient } = await import("@/lib/waitlist/early-access/delivery");
    await expect(deliverEarlyAccessRecipient("recipient-1")).resolves.toBe("FAILED");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: "FAILED",
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );

    await expect(deliverEarlyAccessRecipient("recipient-1")).resolves.toBe("SENT");
    expect(mocks.sendStrictResendEmail).toHaveBeenCalledTimes(2);
  });
});
