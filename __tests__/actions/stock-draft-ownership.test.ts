import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  auth: vi.fn(), enabled: vi.fn(), rate: vi.fn(), transaction: vi.fn(),
  change: vi.fn(), revalidate: vi.fn(), monitor: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/deployment/dealer-stock-sync", () => ({ getDealerStockSyncAvailability: m.enabled }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, makeRateLimitKey: (_: string, id: string) => id }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException: m.monitor }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/dealer-stock-sync/draft-recall", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/dealer-stock-sync/draft-recall")>(),
  changeStockDraftOwnership: m.change,
}));
import { reviewDealerStockDraftOwnership as updateStockDraftOwnership } from "@/actions/admin/dealer-stock-draft-ownership";
import { StockDraftRecallError } from "@/lib/dealer-stock-sync/draft-recall";

const input = {
  reportId: "report", dealerId: "dealer", receiptId: "receipt", listingId: "listing",
  sourceIdentityKey: "source", fingerprint: "a".repeat(64), expectedLifecycleRevision: 1,
  expectedPhotoRevision: 2, expectedUpdatedAt: "2026-11-07T12:00:00.000Z",
  operation: "recall", confirmed: true,
};
describe("admin stock draft ownership action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.auth.mockResolvedValue({ id: "admin", role: "ADMIN" });
    m.enabled.mockReturnValue({ enabled: true });
    m.rate.mockResolvedValue({ allowed: true });
    m.transaction.mockImplementation(async callback => callback({ transaction: "tx" }));
    m.change.mockResolvedValue({ listingId: "listing", dealerId: "dealer", alreadyDone: false });
  });
  it("requires administrator authorization before starting any write", async () => {
    m.auth.mockRejectedValue(new Error("Not authorized"));
    await expect(updateStockDraftOwnership(input)).rejects.toThrow("Not authorized");
    expect(m.auth).toHaveBeenCalledWith("ADMIN");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("requires explicit preservation confirmation and respects deployment/rate guards", async () => {
    expect(await updateStockDraftOwnership({ ...input, confirmed: false })).toHaveProperty("error");
    m.enabled.mockReturnValueOnce({ enabled: false, reason: "Disabled" });
    expect(await updateStockDraftOwnership(input)).toHaveProperty("error");
    m.rate.mockResolvedValueOnce({ allowed: false });
    expect(await updateStockDraftOwnership(input)).toHaveProperty("error");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("uses a serializable transaction and invalidates dealer and admin views after success", async () => {
    expect(await updateStockDraftOwnership(input)).toMatchObject({ data: { alreadyDone: false } });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable", timeout: 30_000,
    });
    expect(m.change).toHaveBeenCalledWith({ transaction: "tx" }, input, { id: "admin", role: "ADMIN" });
    expect(m.revalidate).toHaveBeenCalledWith("/account/listings");
    expect(m.revalidate).toHaveBeenCalledWith("/admin/stock-reviews");
  });
  it("surfaces protected-record conflicts without success invalidation", async () => {
    m.change.mockRejectedValue(new StockDraftRecallError("This draft was submitted. Refresh."));
    expect(await updateStockDraftOwnership(input)).toEqual({ error: "This draft was submitted. Refresh." });
    expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("turns serialization races into a safe refresh request", async () => {
    m.change.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private database conflict", {
      code: "P2034", clientVersion: "test",
    }));
    expect(await updateStockDraftOwnership(input)).toEqual({
      error: "This draft changed during the action. Refresh and check its saved state before retrying.",
    });
    expect(m.revalidate).not.toHaveBeenCalled();
    expect(m.monitor).not.toHaveBeenCalled();
  });
});
