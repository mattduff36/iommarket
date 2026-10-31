import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { discardReceivedStockDraftInTransaction } from "@/lib/dealer-stock-sync/discard-draft";
const receipt = { id: "receipt", listingId: "listing", revisionId: null as string | null, dealerId: "dealer", userId: "owner", reportId: "report", source: { title: "Car" }, blockers: ["missing-price"] };
const listing = { id: "listing", userId: "owner", dealerId: "dealer", status: "DRAFT", lifecycleRevision: 4 };
const image = { provider: "IMAGEKIT", publicId: "imagekit/local/owner/intent", imageKitFileId: "file", imageKitFilePath: "/iommarket-media/local/listings/owner/intent/photo.jpg" };
const tx = { $queryRaw: vi.fn(), stockReviewDraftReceipt: { findUnique: vi.fn() }, listing: { findUnique: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  listingRevision: { deleteMany: vi.fn() }, listingImage: { findMany: vi.fn(), count: vi.fn() }, listingRevisionImage: { findMany: vi.fn(), count: vi.fn() },
  dealerStockSyncAudit: { create: vi.fn() }, listingImageCleanupJob: { create: vi.fn() } };
const run = () => discardReceivedStockDraftInTransaction(tx as unknown as Prisma.TransactionClient, { receiptId: "receipt", expectedLifecycleRevision: 4, userId: "owner" });
beforeEach(() => {
  vi.clearAllMocks(); tx.stockReviewDraftReceipt.findUnique.mockResolvedValue(receipt); tx.listing.findUnique.mockResolvedValue(listing);
  tx.listing.deleteMany.mockResolvedValue({ count: 1 }); tx.listing.updateMany.mockResolvedValue({ count: 1 }); tx.listingRevision.deleteMany.mockResolvedValue({ count: 1 });
  tx.listingImage.findMany.mockResolvedValue([image]); tx.listingRevisionImage.findMany.mockResolvedValue([image]);
  tx.listingImage.count.mockResolvedValue(0); tx.listingRevisionImage.count.mockResolvedValue(0);
});
describe("received stock draft deletion", () => {
  it("deletes only an owned base DRAFT with exact lifecycle revision and retains audit provenance", async () => {
    expect(await run()).toEqual({ listingId: "listing", revisionOnly: false });
    expect(tx.listing.deleteMany).toHaveBeenCalledWith({ where: { id: "listing", userId: "owner", status: "DRAFT", lifecycleRevision: 4 } });
    expect(tx.dealerStockSyncAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "owner", before: expect.objectContaining({ receiptId: "receipt", source: receipt.source, blockers: receipt.blockers }) }) });
    expect(tx.listingImageCleanupJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ imageKitFileId: "file", reason: "received-stock-draft-discarded" }) });
  });
  it.each([{ userId: "other" }, { dealerId: "other" }, { status: "LIVE" }, { status: "PENDING" }, { lifecycleRevision: 5 }])("refuses changed or protected listing: %j", async override => {
    tx.listing.findUnique.mockResolvedValue({ ...listing, ...override });
    await expect(run()).rejects.toThrow(/changed/); expect(tx.listing.deleteMany).not.toHaveBeenCalled();
    expect(tx.listingImageCleanupJob.create).not.toHaveBeenCalled();
  });
  it("rejects another user's receipt before locking or reading listing data", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt, userId: "other" });
    await expect(run()).rejects.toThrow(); expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("deletes only the DRAFT revision and preserves live parent and shared original photos", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt, revisionId: "revision" });
    tx.listing.findUnique.mockResolvedValue({ ...listing, status: "LIVE" }); tx.listingImage.count.mockResolvedValue(1);
    expect(await run()).toEqual({ listingId: "listing", revisionOnly: true });
    expect(tx.listingRevision.deleteMany).toHaveBeenCalledWith({ where: { id: "revision", listingId: "listing", status: "DRAFT" } });
    expect(tx.listing.deleteMany).not.toHaveBeenCalled(); expect(tx.listingImageCleanupJob.create).not.toHaveBeenCalled();
    expect(tx.listing.updateMany.mock.calls[0][0].data).toEqual({ lifecycleRevision: { increment: 1 } });
  });
  it("rejects a revision submitted concurrently without queuing cleanup", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ ...receipt, revisionId: "revision" }); tx.listingRevision.deleteMany.mockResolvedValue({ count: 0 });
    await expect(run()).rejects.toThrow(/changed/); expect(tx.listingImageCleanupJob.create).not.toHaveBeenCalled();
  });
  it("retains assets referenced by another revision", async () => {
    tx.listingRevisionImage.count.mockResolvedValue(1); await run();
    expect(tx.listingImageCleanupJob.create).not.toHaveBeenCalled();
  });
  it("does not proceed when the receipt disappears after taking locks", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValueOnce(receipt).mockResolvedValueOnce(null);
    await expect(run()).rejects.toThrow(); expect(tx.listing.deleteMany).not.toHaveBeenCalled();
  });
});
