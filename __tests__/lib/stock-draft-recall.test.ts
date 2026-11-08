import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const { ready, event } = vi.hoisted(() => ({ ready: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/dealer-stock-sync/draft-readiness", () => ({ assertStoredStockDraftReady: ready }));
vi.mock("@/lib/listings/status-events", () => ({ createListingStatusEvent: event }));
import { changeStockDraftOwnership, stockDraftOwnershipSchema, type StockDraftOwnershipInput } from "@/lib/dealer-stock-sync/draft-recall";

const stamp = new Date("2026-11-07T12:00:00Z");
const listing = () => ({ id: "listing", userId: "owner", dealerId: "dealer", status: "DRAFT", stockReviewHeld: false,
  title: "Dealer saved title", soldAt: null, previewPackId: null, retentionPurgedAt: null, featured: false,
  expiresAt: null, lifecycleRevision: 4, photoRevision: 3, updatedAt: stamp,
  stockSourceIdentity: { bindingId: "binding", sourceIdentityKey: "stock:1", listingId: "listing" } });
const receipt = () => ({ id: "receipt", dealerId: "dealer", userId: "owner", reportId: "report",
  listingId: "listing", revisionId: null, sourceIdentityKey: "stock:1", createdAt: stamp,
  recalledAt: null, recalledReportId: null, recalledById: null, blockers: ["supply-owned-photos"], revision: null, listing: listing() });
const action = { kind: "blocked", section: "change", listingId: "listing", sourceIdentityKey: "stock:1", reason: "status-preserved" };
const report = () => ({ id: "report", bindingId: "binding", dealerId: "dealer", status: "PENDING_REVIEW",
  fingerprint: "a".repeat(64), createdAt: stamp, plan: { actions: [action, { ...action, listingId: "unrelated", sourceIdentityKey: "stock:2" }] } });
const tx = {
  $queryRaw: vi.fn(), listing: { updateMany: vi.fn() },
  dealerStockSyncReport: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  stockReviewDraftReceipt: { findUnique: vi.fn(), updateMany: vi.fn() },
  dealerStockSourceBinding: { findUnique: vi.fn() }, dealerProfile: { findUnique: vi.fn() },
  dealerStockSyncJob: { findFirst: vi.fn() }, listingRevision: { findFirst: vi.fn() },
  dealerStockSyncAudit: { create: vi.fn() },
  payment: { findFirst: vi.fn() }, sampleCheckout: { findFirst: vi.fn() },
};
const input: StockDraftOwnershipInput = { reportId: "report", dealerId: "dealer", receiptId: "receipt", listingId: "listing",
  sourceIdentityKey: "stock:1", fingerprint: "a".repeat(64), expectedLifecycleRevision: 4, expectedPhotoRevision: 3,
  expectedUpdatedAt: stamp.toISOString(), confirmed: true, operation: "recall" };
const run = (override: Partial<StockDraftOwnershipInput> = {}, actor = { id: "admin", role: "ADMIN" }) =>
  changeStockDraftOwnership(tx as unknown as Prisma.TransactionClient, { ...input, ...override }, actor);

beforeEach(() => {
  vi.resetAllMocks();
  tx.dealerStockSyncReport.findUnique.mockResolvedValue(report());
  tx.stockReviewDraftReceipt.findUnique.mockResolvedValue(receipt());
  tx.dealerStockSourceBinding.findUnique.mockResolvedValue({ dealerId: "dealer", enabled: true, verifiedAt: stamp });
  tx.dealerProfile.findUnique.mockResolvedValue({ userId: "owner", isAdminPreview: false, user: { role: "DEALER", disabledAt: null, deletedAt: null } });
  for (const method of [tx.listing.updateMany, tx.stockReviewDraftReceipt.updateMany, tx.dealerStockSyncReport.updateMany]) method.mockResolvedValue({ count: 1 });
});

describe("admin stock draft ownership transaction", () => {
  it("recalls the original record without replacing details, photos, attributes or source identity", async () => {
    expect(await run()).toMatchObject({ listingId: "listing", alreadyDone: false });
    expect(tx.listing.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "listing", userId: "owner", dealerId: "dealer", status: "DRAFT",
        stockReviewHeld: false, lifecycleRevision: 4, photoRevision: 3, updatedAt: stamp }),
      data: { stockReviewHeld: true, lifecycleRevision: { increment: 1 } },
    });
    expect(tx.stockReviewDraftReceipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recalledById: "admin", recalledReportId: "report" }) }));
    const saved = tx.dealerStockSyncReport.updateMany.mock.calls[0][0];
    expect(saved.data.status).toBe("PENDING_REVIEW");
    expect(saved.data.plan.actions[0].reason).toBe("admin-stock-review");
    expect(saved.data.plan.actions[1]).toEqual(report().plan.actions[1]);
    expect(saved.data).not.toHaveProperty("fingerprint");
    expect(tx.dealerStockSyncAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "admin-recall-dealer-draft", before: expect.objectContaining({ listingId: "listing", photoRevision: 3 }),
      after: expect.objectContaining({ preservedListingAndPhotos: true, preservedStaleGuard: true }),
    }) });
    expect(ready).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
  });
  it("recalls verified manual handoffs when automatic scraping is disabled", async () => {
    tx.dealerStockSourceBinding.findUnique.mockResolvedValue({ dealerId: "dealer", enabled: false, verifiedAt: stamp });
    expect(await run()).toMatchObject({ listingId: "listing", alreadyDone: false });
  });
  it("rejects a source binding that is no longer verified", async () => {
    tx.dealerStockSourceBinding.findUnique.mockResolvedValue({ dealerId: "dealer", enabled: false, verifiedAt: null });
    await expect(run()).rejects.toThrow(/changed/);
    expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("restores an origin-report row removed by the original To drafts operation", async () => {
    tx.dealerStockSyncReport.findUnique.mockResolvedValue({ ...report(), status: "REJECTED", plan: { actions: [] } });
    await run();
    expect(tx.dealerStockSyncReport.updateMany.mock.calls[0][0].data.plan.actions).toEqual([expect.objectContaining({ listingId: "listing", reason: "admin-stock-review" })]);
  });
  it("makes duplicate recall a no-write success even with the original version token", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), recalledAt: stamp, recalledReportId: "report",
      listing: { ...listing(), stockReviewHeld: true, lifecycleRevision: 5 } });
    expect(await run()).toMatchObject({ alreadyDone: true });
    expect(tx.listing.updateMany).not.toHaveBeenCalled(); expect(tx.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });
  it("requires admin authorization and explicit confirmation", async () => {
    await expect(run({}, { id: "owner", role: "DEALER" })).rejects.toThrow(/administrators/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(stockDraftOwnershipSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
    expect(stockDraftOwnershipSchema.safeParse({ ...input, operation: "publish" }).success).toBe(false);
  });
  it.each([{ dealerId: "foreign" }, { listingId: "foreign" }, { sourceIdentityKey: "foreign" }, { userId: "foreign" }])("rejects mismatched receipt provenance %j", async override => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), ...override });
    await expect(run()).rejects.toThrow(/changed/); expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("rejects an origin receipt from another binding", async () => {
    tx.dealerStockSyncReport.findUnique.mockResolvedValueOnce(report()).mockResolvedValueOnce(report()).mockResolvedValueOnce({ bindingId: "foreign", dealerId: "dealer" });
    await expect(run()).rejects.toThrow(/changed/);
  });
  it.each([{ lifecycleRevision: 5 }, { photoRevision: 4 }, { updatedAt: new Date(stamp.getTime() + 1) }, { status: "PENDING" }, { status: "LIVE" }, { status: "SOLD", soldAt: stamp }, { featured: true }, { expiresAt: stamp }, { previewPackId: "preview" }, { retentionPurgedAt: stamp }])("preserves concurrently edited/submitted/protected listing %j", async override => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), listing: { ...listing(), ...override } });
    await expect(run()).rejects.toThrow(); expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("does not recall revisions of live listings", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), revisionId: "revision",
      listing: { ...listing(), status: "LIVE" }, revision: { id: "revision", listingId: "listing", status: "DRAFT", version: 1 } });
    await expect(run()).rejects.toThrow(/new dealer drafts only/); expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it.each(["busy", "revision", "newer", "disabled", "stale-report", "sold-source"])("rejects unsafe review context: %s", async condition => {
    if (condition === "busy") tx.dealerStockSyncJob.findFirst.mockResolvedValue({ id: "job" });
    if (condition === "revision") tx.listingRevision.findFirst.mockResolvedValue({ id: "revision" });
    if (condition === "newer") tx.dealerStockSyncReport.findFirst.mockResolvedValue({ id: "newer" });
    if (condition === "disabled") tx.dealerProfile.findUnique.mockResolvedValue({ userId: "owner", user: { role: "DEALER", disabledAt: stamp } });
    if (condition === "stale-report") tx.dealerStockSyncReport.findUnique.mockResolvedValue({ ...report(), fingerprint: "b".repeat(64) });
    if (condition === "sold-source") tx.dealerStockSyncReport.findUnique.mockResolvedValue({ ...report(), plan: { actions: [{ ...action, reason: "source-sold" }] } });
    await expect(run()).rejects.toThrow(); expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("aborts when the listing or receipt compare-and-swap loses, without claiming an audit success", async () => {
    tx.listing.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(run()).rejects.toThrow(/changed/);
    expect(tx.stockReviewDraftReceipt.updateMany).not.toHaveBeenCalled();
    tx.stockReviewDraftReceipt.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(run()).rejects.toThrow(/changed/);
    expect(tx.dealerStockSyncReport.updateMany).not.toHaveBeenCalled(); expect(tx.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });
  it("keeps a usable admin correction row, then explicitly validates and sends the same held draft to moderation", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), recalledAt: stamp, recalledReportId: "report",
      listing: { ...listing(), stockReviewHeld: true } });
    expect(await run({ operation: "moderation" })).toMatchObject({ alreadyDone: false });
    expect(ready).toHaveBeenCalledWith(tx, { listingId: "listing", adminReview: true });
    expect(tx.listing.updateMany.mock.calls[0][0].data).toEqual({ stockReviewHeld: true, lifecycleRevision: { increment: 1 }, status: "PENDING" });
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ action: "SUBMIT", source: "ADMIN", fromStatus: "DRAFT", toStatus: "PENDING" }), tx);
    expect(tx.dealerStockSyncReport.updateMany.mock.calls[0][0].data.plan.actions[0].reason).toBe("submitted-dealer-review");
    expect(tx.stockReviewDraftReceipt.updateMany).not.toHaveBeenCalled();
  });
  it("refuses admin moderation until stored readiness passes, with no writes", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), recalledAt: stamp, listing: { ...listing(), stockReviewHeld: true } });
    ready.mockRejectedValue(new Error("Add at least two verified photos"));
    await expect(run({ operation: "moderation" })).rejects.toThrow(/two verified/);
    expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it.each(["payment", "sampleCheckout"] as const)("preserves payment-protected drafts: %s", async model => {
    tx[model].findFirst.mockResolvedValue({ id: "protected" });
    await expect(run()).rejects.toThrow(/payment/);
    expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("makes duplicate explicit moderation a no-write success", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt(), recalledAt: stamp,
      listing: { ...listing(), stockReviewHeld: true, status: "PENDING", lifecycleRevision: 5 } });
    expect(await run({ operation: "moderation" })).toMatchObject({ alreadyDone: true });
    expect(tx.listing.updateMany).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });
});
