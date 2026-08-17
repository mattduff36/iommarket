import { beforeEach, describe, expect, it, vi } from "vitest";

const { withCostSyncLockMock, executeDeps } = vi.hoisted(() => ({
  withCostSyncLockMock: vi.fn(),
  executeDeps: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/costs/lock", () => ({
  withCostSyncLock: withCostSyncLockMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    costSyncRun: {
      findUnique: executeDeps.findUnique,
    },
  },
}));

import { runCostSync } from "@/lib/costs/sync";

describe("COST-SYNC-001 overlapping sync triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
  });

  it("returns locked when another trigger holds the advisory lock", async () => {
    executeDeps.findUnique.mockResolvedValue(null);
    withCostSyncLockMock.mockResolvedValue({ acquired: false });

    await expect(
      runCostSync({ trigger: "CRON", eventId: "cron:2026-09-02" }),
    ).resolves.toEqual({ status: "locked" });
  });

  it("reuses a succeeded deployment event instead of syncing twice", async () => {
    executeDeps.findUnique.mockResolvedValue({
      id: "run_1",
      status: "SUCCEEDED",
      classifiedCount: 2,
      quarantinedCount: 0,
    });

    await expect(
      runCostSync({ trigger: "DEPLOYMENT", eventId: "dpl_1" }),
    ).resolves.toEqual({
      status: "succeeded",
      runId: "run_1",
      classifiedCount: 2,
      quarantinedCount: 0,
    });
    expect(withCostSyncLockMock).not.toHaveBeenCalled();
  });
});
