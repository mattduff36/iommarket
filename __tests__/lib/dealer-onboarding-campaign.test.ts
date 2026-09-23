import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    dealerPromotionCampaign: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { ensureOnboardingCampaign } from "@/lib/dealers/onboarding/campaign-record";
import { LAUNCH_PROMOTION_TIMEZONE } from "@/lib/dealers/onboarding/campaign-window";
import { ONBOARDING_PRO_ENDS_AT } from "@/lib/dealers/onboarding/grant-plan";

const adminId = "cladminxxxxxxxxxxxxxxxxxx";
const currentCampaign = {
  id: "campaign-1",
  key: "launch-pro",
  timezone: LAUNCH_PROMOTION_TIMEZONE,
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: ONBOARDING_PRO_ENDS_AT,
  tier: "PRO" as const,
  lockedAt: new Date("2026-09-02T00:00:00.000Z"),
  createdByAdminId: adminId,
};

describe("ensureOnboardingCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dealerPromotionCampaign.updateMany.mockResolvedValue({ count: 1 });
  });

  it("creates the fixed campaign without asking for a launch date", async () => {
    mockDb.dealerPromotionCampaign.findUnique.mockResolvedValue(null);
    mockDb.dealerPromotionCampaign.create.mockResolvedValue({
      ...currentCampaign,
      lockedAt: null,
    });
    const campaign = await ensureOnboardingCampaign(adminId);
    expect(campaign.endsAt).toEqual(ONBOARDING_PRO_ENDS_AT);
    expect(mockDb.dealerPromotionCampaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "launch-pro",
        timezone: LAUNCH_PROMOTION_TIMEZONE,
        endsAt: ONBOARDING_PRO_ENDS_AT,
        tier: "PRO",
        createdByAdminId: adminId,
      }),
    });
  });

  it("normalizes an existing campaign without unlocking it or moving its start", async () => {
    mockDb.dealerPromotionCampaign.findUnique.mockResolvedValue({
      ...currentCampaign,
      timezone: "UTC",
      tier: "STARTER",
      endsAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const campaign = await ensureOnboardingCampaign(adminId);
    expect(campaign.startsAt).toEqual(currentCampaign.startsAt);
    expect(campaign.lockedAt).toEqual(currentCampaign.lockedAt);
    expect(campaign.createdByAdminId).toBe(adminId);
    expect(mockDb.dealerPromotionCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: currentCampaign.id },
      data: {
        timezone: LAUNCH_PROMOTION_TIMEZONE,
        tier: "PRO",
        endsAt: ONBOARDING_PRO_ENDS_AT,
      },
    });
  });

  it("leaves a current locked campaign unchanged", async () => {
    mockDb.dealerPromotionCampaign.findUnique.mockResolvedValue(currentCampaign);
    await expect(ensureOnboardingCampaign(adminId)).resolves.toEqual(currentCampaign);
    expect(mockDb.dealerPromotionCampaign.updateMany).not.toHaveBeenCalled();
    expect(mockDb.dealerPromotionCampaign.create).not.toHaveBeenCalled();
  });
});
