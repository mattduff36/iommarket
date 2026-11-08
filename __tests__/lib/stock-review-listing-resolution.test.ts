import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prepareLinkedReviewResolution } from "@/lib/dealer-stock-sync/resolve-listing-edit";
import { loadStockSyncSnapshot } from "@/lib/dealer-stock-sync/snapshot";
import { fingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/fingerprint", () => ({ fingerprintSnapshot: vi.fn() }));
const target = { reportId: "report", fingerprint: "original", sourceIdentityKey: "kia" };
const kia = { kind: "blocked", listingId: "listing", sourceIdentityKey: "kia", reason: "source-conflict" };
const skoda = { kind: "blocked", listingId: null, sourceIdentityKey: "skoda", reason: "missing-price" };
const report = { id: "report", bindingId: "binding", dealerId: "dealer", fingerprint: "original", status: "PENDING_REVIEW", plan: { actions: [kia, skoda] } };
const updateMany = vi.fn(), audit = vi.fn(), findUnique = vi.fn(), busy = vi.fn();
const tx = { $queryRaw: vi.fn(), dealerStockSyncReport: { findUnique, updateMany }, dealerStockSyncJob: { findFirst: busy }, dealerStockSyncAudit: { create: audit } } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.resetAllMocks(); findUnique.mockResolvedValue(report); updateMany.mockResolvedValue({ count: 1 }); busy.mockResolvedValue(null);
  vi.mocked(loadStockSyncSnapshot).mockResolvedValue({ binding: { id: "binding" }, listings: [{ id: "listing" }], identities: [{ sourceIdentityKey: "kia", listingId: "listing" }] } as never);
  vi.mocked(fingerprintSnapshot).mockReturnValueOnce("original").mockReturnValue("next");
});
it("removes only the corrected linked item and rebases a current report after save", async () => {
  const finish = await prepareLinkedReviewResolution(tx, target, "listing", "admin");
  expect(updateMany).not.toHaveBeenCalled();
  await finish();
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fingerprint: "next", status: "PENDING_REVIEW", plan: { actions: [skoda] } }) }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "admin-stock-review-resolved" }) }));
});
it("clears a previously corrected item without making unrelated stale approvals valid", async () => {
  vi.mocked(fingerprintSnapshot).mockReset().mockReturnValue("unrelated-change");
  await (await prepareLinkedReviewResolution(tx, target, "listing", "admin"))();
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fingerprint: "original", plan: { actions: [skoda] } }) }));
});
it("completes the report when its last review item is resolved", async () => {
  findUnique.mockResolvedValue({ ...report, plan: { actions: [kia] } });
  await (await prepareLinkedReviewResolution(tx, target, "listing", "admin"))();
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPLIED" }) }));
});
it("rejects a mismatched listing and does not remove its review", async () => {
  await expect(prepareLinkedReviewResolution(tx, target, "another-listing", "admin")).rejects.toThrow();
  expect(updateMany).not.toHaveBeenCalled();
});
it("rejects an active stock job", async () => {
  busy.mockResolvedValue({ id: "job" });
  await expect(prepareLinkedReviewResolution(tx, target, "listing", "admin")).rejects.toThrow(/current stock task/);
});
it("throws on a raced report update so the enclosing listing transaction rolls back", async () => {
  updateMany.mockResolvedValue({ count: 0 });
  await expect((await prepareLinkedReviewResolution(tx, target, "listing", "admin"))()).rejects.toThrow();
  expect(audit).not.toHaveBeenCalled();
});
