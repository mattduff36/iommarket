import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), load: vi.fn(), fingerprint: vi.fn(), transfer: vi.fn(), enqueue: vi.fn(), notify: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/deployment/dealer-stock-sync", () => ({ getDealerStockSyncAvailability: () => ({ enabled: true }) }));
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: mocks.load }));
vi.mock("@/lib/dealer-stock-sync/fingerprint", () => ({ fingerprintSnapshot: mocks.fingerprint }));
vi.mock("@/lib/dealer-stock-sync/draft-transfer", () => ({ transferStockDrafts: mocks.transfer }));
vi.mock("@/lib/dealer-stock-sync/enqueue", () => ({ enqueueApplyJob: mocks.enqueue }));
vi.mock("@/lib/email/draft-listing-notifications", () => ({ notifyReceivedDraftListings: mocks.notify }));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn().mockResolvedValue(undefined) }));
import { reviewDealerStockSelection } from "@/actions/admin/dealer-stock-selection";
const fingerprint = "a".repeat(64);
const actions = [{ kind: "create", sourceIdentityKey: "new", listingId: null }, { kind: "blocked", sourceIdentityKey: "blocked", listingId: null, section: "new", reason: "missing-price" }];
const report = () => ({ id: "report", bindingId: "binding", dealerId: "dealer", status: "PENDING_REVIEW", fingerprint, plan: { actions } });
const tx = { $queryRaw: vi.fn(), dealerStockSyncReport: { findUnique: vi.fn(), updateMany: vi.fn() }, dealerStockSyncJob: { findFirst: vi.fn() }, dealerStockSyncAudit: { create: vi.fn() } };
const run = (operation: "approve" | "reject" | "draft", actionIndexes = [0]) => reviewDealerStockSelection({ reportId: "report", fingerprint, operation, actionIndexes });
beforeEach(() => {
  vi.clearAllMocks(); mocks.role.mockResolvedValue({ id: "admin" });
  mocks.transaction.mockImplementation(async fn => fn(tx));
  tx.dealerStockSyncReport.findUnique.mockResolvedValue(report());
  tx.dealerStockSyncReport.updateMany.mockResolvedValue({ count: 1 });
  tx.dealerStockSyncJob.findFirst.mockResolvedValue(null);
  tx.dealerStockSyncAudit.create.mockResolvedValue({ id: "audit" });
  mocks.load.mockResolvedValue({ dealer: { id: "dealer", userId: "owner", role: "DEALER" }, binding: { id: "binding" }, activeListingCount: 0, listingCap: 10, actions });
  mocks.fingerprint.mockReturnValue(fingerprint); mocks.enqueue.mockResolvedValue({ id: "job" });
  mocks.transfer.mockResolvedValue([{ listingId: "draft", revisionId: null }]); mocks.notify.mockResolvedValue(undefined);
});
describe("selected stock review mutations", () => {
  it("gives an explicit smaller-batch message for more than 100 drafts", async () => {
    expect(await run("draft", Array.from({ length: 101 }, (_, index) => index))).toHaveProperty("error", expect.stringContaining("100"));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["approve", "reject"] as const)("accepts %s for more than 100 rows", async operation => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ ...actions[0], sourceIdentityKey: String(index) }));
    tx.dealerStockSyncReport.findUnique.mockResolvedValue({ ...report(), plan: { actions: rows } });
    expect(await run(operation, rows.map((_, index) => index))).toHaveProperty("data.count", 150);
  });
  it("requires administrator authorization before touching a report", async () => {
    mocks.role.mockRejectedValue(new Error("Forbidden"));
    await expect(run("approve")).rejects.toThrow("Forbidden");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("refuses stale state before any write", async () => {
    mocks.fingerprint.mockReturnValue("changed");
    expect(await run("draft")).toHaveProperty("error", expect.stringContaining("Run a new stock check"));
    expect(mocks.transfer).not.toHaveBeenCalled(); expect(tx.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();
  });
  it("queues only selected eligible actions and durably keeps the remainder", async () => {
    expect(await run("approve")).toHaveProperty("data.jobId", "job");
    expect(tx.dealerStockSyncReport.updateMany.mock.calls[0][0].data).toMatchObject({ status: "APPROVED", plan: { actions: [actions[0]], pendingReviewActions: [actions[1]] } });
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, expect.objectContaining({ reviewSelection: true }));
  });
  it("rejects only the selection, keeping unselected work pending", async () => {
    await run("reject", [1]);
    expect(tx.dealerStockSyncReport.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PENDING_REVIEW", plan: { actions: [actions[0]] } });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("blocks overlapping jobs and blocked approvals", async () => {
    expect(await run("approve", [1])).toHaveProperty("error");
    tx.dealerStockSyncJob.findFirst.mockResolvedValue({ id: "busy" });
    expect(await run("reject")).toHaveProperty("error");
    expect(tx.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();
  });
  it("does not notify when the report write fence is lost", async () => {
    tx.dealerStockSyncReport.updateMany.mockResolvedValue({ count: 0 });
    expect(await run("draft")).toHaveProperty("error");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("preserves the dealer listing allowance when creating received drafts", async () => {
    mocks.load.mockResolvedValue({ dealer: { id: "dealer", userId: "owner", role: "DEALER" }, binding: { id: "binding" }, activeListingCount: 10, listingCap: 10, actions });
    expect(await run("draft")).toHaveProperty("error", expect.stringContaining("allowance"));
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("reports successful draft commit even when notification fails", async () => {
    mocks.notify.mockRejectedValue(new Error("offline"));
    const result = await run("draft");
    expect(result).toHaveProperty("data.deliveryKey", "audit"); expect(result).toHaveProperty("warning");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ deliveryKey: "audit", userId: "owner", count: 1 }));
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
