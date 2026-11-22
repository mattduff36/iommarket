import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { deleteDraftInTransaction } from "@/lib/listings/delete-draft";

const draft = { id: "listing", userId: "owner", status: "DRAFT", lifecycleRevision: 2,
  ownerArchivedAt: null, stockReviewHeld: false, payments: [], paymentCheckoutAttempts: [],
  freeListingClaim: null, statusEvents: [], stockDraftReceipts: [], images: [] };
const tx = { $queryRaw: vi.fn(), listing: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
  listingStatusEvent: { create: vi.fn() }, listingImage: { count: vi.fn() },
  listingRevisionImage: { count: vi.fn() }, listingImageCleanupJob: { create: vi.fn() } };
const run = () => deleteDraftInTransaction(tx as unknown as Prisma.TransactionClient,
  { listingId: "listing", userId: "owner", expectedRevision: 2 });

beforeEach(() => {
  vi.clearAllMocks();
  tx.listing.findUnique.mockResolvedValue(draft);
});

describe("owner draft deletion", () => {
  it("deletes an unused owned draft after acquiring its row lock", async () => {
    await run();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.listing.delete).toHaveBeenCalledWith({ where: { id: "listing" } });
  });
  it.each([{ status: "PENDING" }, { status: "LIVE" }, { lifecycleRevision: 3 },
    { userId: "other" }, { ownerArchivedAt: new Date() }, { stockReviewHeld: true },
    { stockDraftReceipts: [{ id: "receipt" }] }])("rejects changed or protected drafts %j", async (change) => {
    tx.listing.findUnique.mockResolvedValue({ ...draft, ...change });
    await expect(run()).rejects.toThrow();
    expect(tx.listing.delete).not.toHaveBeenCalled();
    expect(tx.listing.update).not.toHaveBeenCalled();
  });
  it.each([{ payments: [{ id: "p" }] }, { paymentCheckoutAttempts: [{ id: "a" }] },
    { statusEvents: [{ id: "live-event" }] }, { freeListingClaim: { id: "claim" } }])(
    "archives drafts with durable history %j", async (history) => {
      tx.listing.findUnique.mockResolvedValue({ ...draft, ...history });
      await run();
      expect(tx.listing.delete).not.toHaveBeenCalled();
      expect(tx.listing.update).toHaveBeenCalledWith({ where: { id: "listing" },
        data: { ownerArchivedAt: expect.any(Date), status: "TAKEN_DOWN", lifecycleRevision: { increment: 1 } } });
      expect(tx.listingStatusEvent.create).toHaveBeenCalledOnce();
    });
  it("does not enqueue a shared image for cleanup", async () => {
    tx.listing.findUnique.mockResolvedValue({ ...draft, images: [{ provider: "CLOUDINARY", publicId: "shared" }] });
    tx.listingImage.count.mockResolvedValue(1);
    tx.listingRevisionImage.count.mockResolvedValue(0);
    await run();
    expect(tx.listingImageCleanupJob.create).not.toHaveBeenCalled();
  });
});
