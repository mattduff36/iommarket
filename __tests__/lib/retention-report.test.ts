import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, getPolicyFlagsMock, getSettingMock } = vi.hoisted(() => ({
  mockDb: {
    retentionLegalHold: { findMany: vi.fn() },
    listing: { findMany: vi.fn(), updateMany: vi.fn() },
    listingView: { findMany: vi.fn(), deleteMany: vi.fn() },
    report: { findMany: vi.fn(), updateMany: vi.fn() },
    dealerReview: { findMany: vi.fn(), deleteMany: vi.fn() },
    waitlistUser: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    retentionRun: { create: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn(),
  },
  getPolicyFlagsMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/policy/flags", () => ({
  RETENTION_ENTITY_TYPES: [
    "LISTING",
    "LISTING_VIEW",
    "REPORT",
    "DEALER_REVIEW",
    "MONITORING",
    "WAITLIST_USER",
  ],
  getPolicyFlags: getPolicyFlagsMock,
}));
vi.mock("@/lib/config/site-settings", () => ({
  SETTING_KEYS: { WAITLIST_CAMPAIGN_CLOSED_AT: "waitlist_campaign_closed_at" },
  getSetting: getSettingMock,
}));

import { runRetentionPass } from "@/lib/retention/report";

describe("retention report POL-RET-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPolicyFlagsMock.mockReturnValue({
      canMutateRetention: false,
      retentionEntityAllowlist: [],
    });
    getSettingMock.mockResolvedValue(null);
    mockDb.retentionLegalHold.findMany.mockResolvedValue([]);
    mockDb.listing.findMany.mockResolvedValue([{ id: "listing-1" }]);
    mockDb.listingView.findMany.mockResolvedValue([{ id: "view-1" }]);
    mockDb.report.findMany.mockResolvedValue([]);
    mockDb.dealerReview.findMany.mockResolvedValue([]);
    mockDb.waitlistUser.findMany.mockResolvedValue([]);
    mockDb.retentionRun.create.mockResolvedValue({ id: "run-1" });
    mockDb.retentionRun.update.mockResolvedValue({});
    mockDb.$executeRaw.mockResolvedValue(1);
  });

  it("writes a report-only run and does not mutate rows", async () => {
    const result = await runRetentionPass(new Date("2026-08-15T00:00:00Z"));

    expect(result.mode).toBe("report");
    expect(result.counts.LISTING).toBe(1);
    expect(mockDb.listing.updateMany).not.toHaveBeenCalled();
    expect(mockDb.listingView.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.retentionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("mutates through hold-excluding SQL and records the allowlist POL-RET-001-A", async () => {
    getPolicyFlagsMock.mockReturnValue({
      canMutateRetention: true,
      retentionEntityAllowlist: ["LISTING"],
    });

    const result = await runRetentionPass(new Date("2026-08-15T00:00:00Z"));

    expect(result.mode).toBe("mutate");
    expect(result.counts.LISTING).toBe(1);
    expect(mockDb.listing.updateMany).not.toHaveBeenCalled();
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    expect(mockDb.retentionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: "mutate",
          entityTypes: ["LISTING"],
        }),
      }),
    );
  });

  it("excludes legally held listings from the eligible set", async () => {
    mockDb.retentionLegalHold.findMany.mockImplementation(
      async ({ where }: { where: { entityType: string } }) =>
        where.entityType === "LISTING" ? [{ entityId: "listing-1" }] : [],
    );

    const result = await runRetentionPass(new Date("2026-08-15T00:00:00Z"));
    expect(result.counts.LISTING).toBe(0);
  });

  it("selects reviews removed for 24 months for cascade deletion MD-REV-004", async () => {
    mockDb.dealerReview.findMany.mockResolvedValue([{ id: "review-removed" }]);

    const result = await runRetentionPass(new Date("2026-08-17T00:00:00Z"));

    expect(result.counts.DEALER_REVIEW).toBe(1);
    expect(mockDb.dealerReview.findMany).toHaveBeenCalledWith({
      where: {
        removedAt: { lte: new Date("2024-08-17T00:00:00.000Z") },
      },
      select: { id: true },
      take: 500,
    });
  });
});
