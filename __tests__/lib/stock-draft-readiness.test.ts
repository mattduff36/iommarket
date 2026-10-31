import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { assertStockDraftReady, isOwnedStockDraftPhoto } from "@/lib/dealer-stock-sync/draft-readiness";
const policy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/listings/listing-ns-policy", () => ({ validateListingAttributesWithServerPolicy: policy }));
const receipt = { id: "receipt-1", listingId: "listing-1", revisionId: null, userId: "user-1" };
const photo = { provider: "IMAGEKIT", publicId: "imagekit/local/user/intent", imageKitFileId: "file", imageKitFilePath: "/iommarket-media/local/listings/user/intent/photo.jpg", url: "imagekit-private:/iommarket-media/local/listings/user/intent/photo.jpg" };
const valid = () => ({ userId: "user-1", status: "DRAFT", title: "Ford Focus", description: "A complete and accurate description of this vehicle.", price: 150000,
  categoryId: "car", regionId: "cm000000000000000000000000", trustDeclarationAccepted: true,
  category: { active: true, slug: "car", attributeDefinitions: [] }, region: { active: true },
  attributeValues: [], images: [photo, photo],
});
const tx = { $queryRaw: vi.fn(), listing: { findUnique: vi.fn() }, listingRevision: { findUnique: vi.fn() }, stockReviewDraftReceipt: { update: vi.fn() } };
const submit = (ack = receipt.id) => assertStockDraftReady(tx as unknown as Prisma.TransactionClient, { receipt, actorId: "user-1", acknowledgementReceiptId: ack });
beforeEach(() => { vi.clearAllMocks(); policy.mockReturnValue({ fieldErrors: {} }); tx.listing.findUnique.mockResolvedValue(valid()); });

describe("received stock draft submission", () => {
  it("requires explicit acknowledgement of this exact receipt", async () => {
    await expect(submit("other")).rejects.toThrow(/confirm/);
    expect(tx.stockReviewDraftReceipt.update).not.toHaveBeenCalled();
  });
  it.each([ { title: "" }, { price: 0 }, { description: "" }, { trustDeclarationAccepted: false }, { images: [] }, { images: [{ ...photo, provider: "EXTERNAL" }, photo] } ])("blocks incomplete or unowned data: %j", async override => {
    tx.listing.findUnique.mockResolvedValue({ ...valid(), ...override });
    await expect(submit()).rejects.toThrow();
    expect(tx.stockReviewDraftReceipt.update).not.toHaveBeenCalled();
  });
  it("blocks unresolved required attributes despite valid basic fields", async () => {
    policy.mockReturnValue({ fieldErrors: { mileage: ["Mileage is required."] } });
    await expect(submit()).rejects.toThrow("Mileage is required.");
  });
  it("records the acknowledgement only after full readiness succeeds", async () => {
    await submit();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.stockReviewDraftReceipt.update).toHaveBeenCalledWith({ where: { id: receipt.id }, data: { reviewAcknowledgedAt: expect.any(Date), acknowledgedById: "user-1" } });
  });
  it("allows corrected rejected drafts to be submitted again", async () => {
    tx.listing.findUnique.mockResolvedValue({ ...valid(), status: "REJECTED" });
    await submit();
    expect(tx.stockReviewDraftReceipt.update).toHaveBeenCalled();
  });
  it("rejects a changed listing owner", async () => {
    tx.listing.findUnique.mockResolvedValue({ ...valid(), userId: "other" });
    await expect(submit()).rejects.toThrow(/changed/);
  });
  it("rejects spoofed paths and external delivery URLs", () => {
    expect(isOwnedStockDraftPhoto(photo)).toBe(true);
    expect(isOwnedStockDraftPhoto({ ...photo, publicId: "different" })).toBe(false);
    expect(isOwnedStockDraftPhoto({ ...photo, url: "https://dealer.example/photo.jpg" })).toBe(false);
  });
});
