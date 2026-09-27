import { beforeEach, describe, expect, it, vi } from "vitest";

const { withCostSyncLockMock, executeDeps } = vi.hoisted(() => ({
  withCostSyncLockMock: vi.fn(),
  executeDeps: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/costs/lock", () => ({
  withCostSyncLock: withCostSyncLockMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    costSyncRun: {
      findUnique: executeDeps.findUnique,
      updateMany: executeDeps.updateMany,
    },
  },
}));

import {
  batchCostSyncWork,
  COST_SYNC_TRANSACTION_BATCH_SIZE,
  COST_SYNC_STALE_CODE,
  MAX_COST_WRITES_PER_RUN,
  recoverStaleCostSyncRuns,
  runCostSync,
  takeCostSyncWork,
} from "@/lib/costs/sync";

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

  it("caps write work and leaves the remainder for an idempotent continuation", () => {
    const pending = Array.from(
      { length: MAX_COST_WRITES_PER_RUN + 2 },
      (_, index) => `charge-${index}`,
    );

    expect(takeCostSyncWork(pending)).toEqual({
      items: pending.slice(0, MAX_COST_WRITES_PER_RUN),
      hasMore: true,
    });
    expect(takeCostSyncWork(["one", "two"])).toEqual({
      items: ["one", "two"],
      hasMore: false,
    });
    expect(COST_SYNC_TRANSACTION_BATCH_SIZE).toBe(3);
    expect(batchCostSyncWork(["one", "two", "three", "four"])).toEqual([
      ["one", "two", "three"],
      ["four"],
    ]);
  });

  it("marks abandoned running syncs failed before another writer starts", async () => {
    executeDeps.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-09-27T12:00:00.000Z");

    await expect(recoverStaleCostSyncRuns(now)).resolves.toBe(2);
    expect(executeDeps.updateMany).toHaveBeenCalledWith({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date("2026-09-27T11:45:00.000Z") },
      },
      data: {
        status: "FAILED",
        errorCode: COST_SYNC_STALE_CODE,
        completedAt: now,
      },
    });
  });
});
