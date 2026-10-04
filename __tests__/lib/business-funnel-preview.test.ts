import { beforeEach, describe, expect, it, vi } from "vitest";
import { excludePreviewPackUsersWhere } from "@/lib/preview-packs/frontend-visibility";

const subscriptionCount = vi.fn();
const userCount = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    listingView: { count: vi.fn().mockResolvedValue(0) },
    user: { count: (...args: unknown[]) => userCount(...args) },
    listing: { count: vi.fn().mockResolvedValue(0) },
    payment: { count: vi.fn().mockResolvedValue(0) },
    favourite: { count: vi.fn().mockResolvedValue(0) },
    savedSearch: { count: vi.fn().mockResolvedValue(0) },
    subscription: { count: (...args: unknown[]) => subscriptionCount(...args) },
  },
}));

describe("business funnel preview exclusion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userCount.mockResolvedValue(0);
    subscriptionCount.mockResolvedValue(0);
  });

  it("keeps preview users and dealer subscriptions out of production activity totals", async () => {
    const { loadBusinessFunnel } = await import("@/lib/analytics/business-funnel");
    const sampleVisibility = { privateListings: true, dealerListings: true };
    await loadBusinessFunnel({
      since: new Date("2026-09-01T00:00:00.000Z"),
      sampleVisibility,
      liveWhere: { status: "LIVE" },
    });

    expect(userCount).toHaveBeenCalledWith({
      where: {
        AND: [
          { createdAt: { gte: new Date("2026-09-01T00:00:00.000Z") } },
          excludePreviewPackUsersWhere(),
        ],
      },
    });
    expect(JSON.stringify(subscriptionCount.mock.calls[0][0].where)).toContain(
      '"isAdminPreview":false',
    );
  });
});
