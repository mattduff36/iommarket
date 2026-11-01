/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), dealerStockSyncReport: { findUnique: vi.fn() } },
  persist: vi.fn(), lease: vi.fn(), run: vi.fn(), authorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/dealer-stock-sync/persist-report", () => ({ persistFailedScrape: mocks.persist }));
vi.mock("@/scripts/dealer-stock-sync/execute-job", () => ({ leaseOneJob: mocks.lease, runLeasedJob: mocks.run }));
vi.mock("@/lib/dealer-stock-sync/desktop-service", () => ({
  authoriseDesktopRequest: mocks.authorize,
  liveDesktopDependencies: () => ({ store: { consumeRate: async () => true } }),
}));
import { createDesktopJobDependencies } from "@/lib/dealer-stock-sync/desktop-job-executor";
import type { DesktopFailScrapeInput } from "@/lib/dealer-stock-sync/desktop-jobs";

const input: DesktopFailScrapeInput = {
  jobId: "job", busyOwner: "busy-owner", bindingId: "binding", dealerId: "dealer",
  registryKey: "mikes-motors", failureReason: "source-failed", expiresAt: new Date(Date.now() + 900000),
};
function transaction(binding = { id: "binding", dealerId: "dealer", registryKey: "mikes-motors", verifiedAt: new Date() }) {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => { order.push("lock-binding"); return []; }),
    dealerStockSourceBinding: { findUnique: vi.fn(async () => { order.push("binding"); return binding; }) },
    dealerStockSyncJob: { updateMany: vi.fn(async (_args: unknown) => { order.push("fence"); return { count: 1 }; }) },
  };
  mocks.db.$transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.persist.mockImplementation(async () => { order.push("persist"); });
  return { tx, order };
}

describe("desktop jobs database adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("forwards the request-scoped guard without changing process flags", async () => {
    const deps = createDesktopJobDependencies({});
    const guard = vi.fn();
    const scrape = vi.fn();
    const before = process.env.DEALER_STOCK_SYNC_WORKER;
    await deps.leaseOneJob("hashed-device-owner", new Date(0), guard);
    await deps.runLeasedJob({ id: "job", owner: "busy-owner" }, scrape, undefined, guard);
    expect(mocks.lease).toHaveBeenCalledWith("hashed-device-owner", new Date(0), guard, undefined);
    expect(mocks.run).toHaveBeenCalledWith({ id: "job", owner: "busy-owner" }, scrape, undefined, guard);
    expect(process.env.DEALER_STOCK_SYNC_WORKER).toBe(before);
  });

  it("locks and rechecks the binding before persisting a failed scrape under the busy lease", async () => {
    const { tx, order } = transaction();
    const deps = createDesktopJobDependencies({});
    expect(await deps.failScrape(input)).toBe("failed");
    expect(order).toEqual(["lock-binding", "binding", "fence", "persist", "fence"]);
    expect(tx.dealerStockSyncJob.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "job", status: "LEASED", leaseOwner: "busy-owner", leaseExpiresAt: { gt: expect.any(Date) } },
    });
    expect(mocks.persist).toHaveBeenCalledWith(tx, {
      bindingId: "binding", dealerId: "dealer", scrapeRunId: "job", jobId: "job", failureReason: "source-failed",
    });
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 30000 });
  });

  it("persists nothing after a binding change or lost busy lease", async () => {
    let current = transaction({ id: "binding", dealerId: "other-dealer", registryKey: "mikes-motors", verifiedAt: new Date() });
    const deps = createDesktopJobDependencies({});
    expect(await deps.failScrape(input)).toBe("lost");
    expect(current.tx.dealerStockSyncJob.updateMany).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    current = transaction();
    current.tx.dealerStockSyncJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await deps.failScrape(input)).toBe("lost");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("selects only report authorization fields and maps invalid grants to a safe job error", async () => {
    const deps = createDesktopJobDependencies({});
    await deps.reports.findById("report");
    expect(mocks.db.dealerStockSyncReport.findUnique).toHaveBeenCalledWith({
      where: { id: "report" },
      select: { id: true, bindingId: true, dealerId: true, fingerprint: true, status: true, approvedById: true },
    });
    mocks.authorize.mockResolvedValue({ ok: false, status: 401, error: "invalid_grant" });
    expect(await deps.authorize("Bearer revoked")).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });
});
