/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(), query: vi.fn(), find: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $queryRawUnsafe: mocks.query,
  dealerStockSyncJob: { findUnique: mocks.find },
} }));
vi.mock("@/lib/dealer-stock-sync/worker-guard", () => ({ assertWorkerEnabled: mocks.enabled }));
import { leaseOneJob, runLeasedJob } from "@/scripts/dealer-stock-sync/execute-job";

describe("stock executor guard seam", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: "job" }]);
    mocks.find.mockResolvedValue(null);
  });

  it("retains the legacy default guard and blocks database access when disabled", async () => {
    mocks.enabled.mockImplementation(() => { throw new Error("disabled"); });
    await expect(leaseOneJob()).rejects.toThrow("disabled");
    await expect(runLeasedJob({ id: "job", owner: "owner" }, vi.fn())).rejects.toThrow("disabled");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("accepts a server-supplied guard and hashed owner without mutating global flags", async () => {
    const guard = vi.fn();
    const before = process.env.DEALER_STOCK_SYNC_WORKER;
    const owner = "a".repeat(64);
    expect(await leaseOneJob(owner, new Date(0), guard)).toEqual({ id: "job", owner });
    await runLeasedJob({ id: "job", owner }, vi.fn(), undefined, guard);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), owner, new Date(15 * 60 * 1000));
    expect(process.env.DEALER_STOCK_SYNC_WORKER).toBe(before);
  });

  it("does not execute an expired or foreign-owned leased job", async () => {
    const scrape = vi.fn();
    const guard = vi.fn();
    for (const record of [
      { id: "job", status: "LEASED", leaseOwner: "other", leaseExpiresAt: new Date(Date.now() + 60000) },
      { id: "job", status: "LEASED", leaseOwner: "owner", leaseExpiresAt: new Date(0) },
    ]) {
      mocks.find.mockResolvedValue(record);
      await runLeasedJob({ id: "job", owner: "owner" }, scrape, undefined, guard);
    }
    expect(scrape).not.toHaveBeenCalled();
  });
});
