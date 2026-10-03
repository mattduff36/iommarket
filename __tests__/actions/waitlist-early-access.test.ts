/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  audience: vi.fn(),
  createMany: vi.fn(),
  deliver: vi.fn(),
  logAdminAction: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.logAdminAction }));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/waitlist/early-access/delivery", () => ({
  deliverEarlyAccessBatch: mocks.deliver,
}));
vi.mock("@/lib/db", () => ({
  db: {
    waitlistEarlyAccessCampaign: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        waitlistEarlyAccessCampaign: {
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        waitlistUser: { findMany: mocks.audience },
        waitlistEarlyAccessRecipient: { createMany: mocks.createMany },
      }),
  },
}));

const draft = {
  id: "campaign-1",
  key: "cars-buying-or-selling",
  status: "DRAFT",
  bodyText: "You are invited.",
};

describe("confirmEarlyAccessCampaign", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "");
    mocks.requireRole.mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "ADMIN" });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      unavailable: false,
    });
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue(draft);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.audience.mockResolvedValue([{ id: "waitlist-1" }, { id: "waitlist-2" }]);
    mocks.createMany.mockResolvedValue({ count: 2 });
    mocks.update.mockResolvedValue(draft);
    mocks.deliver.mockResolvedValue({ sent: 2, failed: 0, skipped: 0, blocked: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("freezes the audience once and does not enroll again after confirmation", async () => {
    const { confirmEarlyAccessCampaign } = await import("@/actions/admin/waitlist-early-access");
    const input = { bodyText: "You are invited.", confirmation: "SEND EARLY ACCESS" };

    await expect(confirmEarlyAccessCampaign(input)).resolves.toEqual({
      data: { campaignId: "campaign-1", recipientTotal: 2, delivery: { sent: 2, failed: 0, skipped: 0, blocked: false } },
    });
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ waitlistUserId: "waitlist-1", deliveryStatus: "PENDING" }),
          expect.objectContaining({ waitlistUserId: "waitlist-2", deliveryStatus: "PENDING" }),
        ],
        skipDuplicates: true,
      }),
    );

    mocks.findUnique.mockResolvedValue({ ...draft, status: "QUEUED" });
    await expect(confirmEarlyAccessCampaign(input)).resolves.toEqual({
      data: { campaignId: "campaign-1", alreadyConfirmed: true },
    });
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });

  it("does not enroll the audience outside closed production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_LAUNCH_GATE_QA", "1");
    const { confirmEarlyAccessCampaign } = await import("@/actions/admin/waitlist-early-access");
    await expect(
      confirmEarlyAccessCampaign({ bodyText: "You are invited.", confirmation: "SEND EARLY ACCESS" }),
    ).resolves.toEqual({
      error: "Waitlist invitations can only be sent from production while the site is still closed.",
    });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
