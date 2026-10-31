import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: load }));
vi.mock("@/lib/dealer-stock-sync/fingerprint", () => ({ fingerprintSnapshot: () => "fresh-fingerprint" }));
import { completeStockReviewSelection } from "@/lib/dealer-stock-sync/selection-completion";
const update = vi.fn();
const tx = { dealerStockSyncReport: { updateMany: update } } as unknown as Prisma.TransactionClient;
beforeEach(() => { vi.clearAllMocks(); load.mockResolvedValue({}); update.mockResolvedValue({ count: 1 }); });
describe("partial apply completion", () => {
  it("restores blocked remainder with a fresh post-write snapshot and stale-write guard", async () => {
    const remaining = [{ kind: "blocked", sourceIdentityKey: "b", reason: "missing-price", section: "new" }];
    await completeStockReviewSelection(tx, { id: "r", dealerId: "d", fingerprint: "approved", plan: { actions: [{ kind: "create" }], pendingReviewActions: remaining } });
    expect(load).toHaveBeenCalledWith("d", remaining, tx);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r", status: "APPLIED", fingerprint: "approved" }, data: expect.objectContaining({ status: "PENDING_REVIEW", fingerprint: "fresh-fingerprint", plan: { actions: remaining }, approvedById: null }) }));
  });
  it("leaves a completed batch applied when no reviewable remainder exists", async () => {
    const applied = [{ kind: "create", sourceIdentityKey: "created", title: "Applied vehicle" }];
    await completeStockReviewSelection(tx, { id: "r", dealerId: "d", fingerprint: "approved", plan: { actions: applied, pendingReviewActions: [] } });
    expect(update.mock.calls[0][0].data.status).toBe("APPLIED");
    expect(update.mock.calls[0][0].data.plan).toEqual({ actions: applied });
    expect(load).toHaveBeenCalledWith("d", applied, tx);
  });
  it("keeps applied evidence alongside unchanged rows at completion", async () => {
    const applied = [{ kind: "update", sourceIdentityKey: "changed" }];
    const remaining = [{ kind: "unchanged", sourceIdentityKey: "unchanged" }];
    await completeStockReviewSelection(tx, { id: "r", dealerId: "d", fingerprint: "approved", plan: { actions: applied, pendingReviewActions: remaining } });
    expect(update.mock.calls[0][0].data.plan).toEqual({ actions: [...applied, ...remaining] });
    expect(update.mock.calls[0][0].data.status).toBe("APPLIED");
  });
  it("does not rewrite legacy whole-report approvals", async () => {
    await completeStockReviewSelection(tx, { id: "r", dealerId: "d", fingerprint: "approved", plan: { actions: [] } });
    expect(update).not.toHaveBeenCalled();
  });
  it("rolls back the batch if restoring the remainder loses its fence", async () => {
    update.mockResolvedValue({ count: 0 });
    await expect(completeStockReviewSelection(tx, { id: "r", dealerId: "d", fingerprint: "approved", plan: { pendingReviewActions: [] } })).rejects.toThrow(/changed/);
  });
});
