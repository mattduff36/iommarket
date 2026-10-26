/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(), query: vi.fn(), find: vi.fn(), binding: vi.fn(), transaction: vi.fn(), jobUpdateMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $queryRawUnsafe: mocks.query,
  $transaction: mocks.transaction,
  dealerStockSyncJob: { findUnique: mocks.find, updateMany: mocks.jobUpdateMany },
  dealerStockSourceBinding: { findUnique: mocks.binding },
} }));
vi.mock("@/lib/dealer-stock-sync/worker-guard", () => ({ assertWorkerEnabled: mocks.enabled }));
import { leaseOneJob, runLeasedJob } from "@/scripts/dealer-stock-sync/execute-job";
import type { PipelineResult } from "@/scripts/dealer-stock-sync/types";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";

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

  it("keeps a failed scrape report failed with its report id and still runs the next dealer", async () => {
    const created: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const jobs = [
      { id: "job-manx", bindingId: "binding-manx", dealerId: "dealer-manx", registryKey: "manx-car-warehouse" },
      { id: "job-next", bindingId: "binding-next", dealerId: "dealer-next", registryKey: "bcc-cars" },
    ];
    let active = jobs[0]!;
    const scrape = vi.fn(async (registryKey: string): Promise<PipelineResult> => ({
      dealer: getDealer(registryKey),
      canArchive: false,
      sourceResults: [{
        dealerKey: registryKey, sourceKey: "stock", platform: "html-structured", status: "failed",
        error: "token-must-not-persist", startUrl: "https://dealer.example/stock", pagesFetched: 1,
        advertisedCount: null, rawCount: null, vehicles: [],
      }],
      reconciled: [],
      scrapeStartedAt: "2026-10-26T00:00:00.000Z",
      scrapeFinishedAt: "2026-10-26T00:00:00.000Z",
    }));
    mocks.find.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const job = jobs.find((item) => item.id === where.id)!;
      return {
        ...job, kind: "SCRAPE", status: "LEASED", leaseOwner: "owner", payload: { registryKey: job.registryKey },
        reportId: null, leaseExpiresAt: new Date(Date.now() + 60_000),
      };
    });
    mocks.binding.mockImplementation(async () => ({
      registryKey: active.registryKey, verifiedAt: new Date(), dealerId: active.dealerId,
      dealer: { isAdminPreview: false, user: { id: "user", role: "DEALER", disabledAt: null, deletedAt: null, regionId: "region" } },
    }));
    const tx = {
      $queryRaw: vi.fn(async () => []),
      dealerStockSourceBinding: { findUnique: vi.fn(async () => ({ dealerId: active.dealerId, verifiedAt: new Date(), registryKey: active.registryKey })) },
      dealerStockSourceIdentity: { updateMany: vi.fn(async () => ({ count: 0 })) },
      dealerStockSyncReport: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `report-${active.id}`, fingerprint: active.id };
        }),
      },
      dealerStockSyncAudit: { create: vi.fn(async () => ({ id: "audit" })) },
      dealerStockSyncJob: {
        updateMany: vi.fn(async ({ where }: { where: { status: string; leaseOwner: string } }) => ({ count: where.status === "LEASED" && where.leaseOwner === "owner" ? 1 : 0 })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push({ id: active.id, data });
          return data;
        }),
      },
    };
    mocks.transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
    await runLeasedJob({ id: "job-manx", owner: "owner" }, scrape, undefined, vi.fn());
    active = jobs[1]!;
    await runLeasedJob({ id: "job-next", owner: "owner" }, scrape, undefined, vi.fn());
    expect(scrape.mock.calls.map(([key]) => key)).toEqual(["manx-car-warehouse", "bcc-cars"]);
    expect(updates.map((item) => item.data)).toMatchObject([
      { status: "FAILED", leaseExpiresAt: null, error: "Stock sync job failed.", reportId: "report-job-manx" },
      { status: "FAILED", leaseExpiresAt: null, error: "Stock sync job failed.", reportId: "report-job-next" },
    ]);
    expect(updates.every((item) => item.data.status !== "SUCCEEDED" && !("attempt" in item.data))).toBe(true);
    expect(created[0]).toMatchObject({ status: "FAILED", plan: { actions: [], patches: [], diagnostics: [{ sourceKey: "stock", status: "failed", count: 0 }] } });
    expect(JSON.stringify(created)).not.toContain("token-must-not-persist");
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
    expect(tx.dealerStockSyncJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "LEASED", leaseOwner: "owner" }),
    }));
  });
});
