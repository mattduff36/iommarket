import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn(), discard: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedAuth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/discard-draft", () => ({ discardReceivedStockDraftInTransaction: mocks.discard, StockDraftDiscardError: class extends Error {} }));
import { discardReceivedStockDraft } from "@/actions/stock-drafts";
const input = { receiptId: "receipt", expectedLifecycleRevision: 2 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "owner" }); mocks.limit.mockResolvedValue({ allowed: true });
  mocks.transaction.mockImplementation(async fn => fn("tx")); mocks.discard.mockResolvedValue({ listingId: "listing", revisionOnly: false });
});
describe("discard received draft action", () => {
  it("requires accepted authentication before reading draft data", async () => {
    mocks.auth.mockRejectedValue(new Error("Unauthorized"));
    await expect(discardReceivedStockDraft(input)).rejects.toThrow("Unauthorized");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects malformed lifecycle input and rate limited requests", async () => {
    expect(await discardReceivedStockDraft({ ...input, expectedLifecycleRevision: -1 })).toHaveProperty("error");
    mocks.limit.mockResolvedValue({ allowed: false });
    expect(await discardReceivedStockDraft(input)).toHaveProperty("error"); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("uses authenticated owner and a serializable transaction", async () => {
    expect(await discardReceivedStockDraft(input)).toEqual({ data: { listingId: "listing", revisionOnly: false } });
    expect(mocks.discard).toHaveBeenCalledWith("tx", { ...input, userId: "owner" });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 15000 });
  });
});
