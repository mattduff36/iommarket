import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
const clone = vi.hoisted(() => vi.fn());
const claim = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media/managed-import", () => ({ claimManagedImportsForAttachment: claim }));
vi.mock("@/lib/listings/revision-photos", () => ({ cloneLiveImagesToRevision: clone }));
import { transferStockDrafts } from "@/lib/dealer-stock-sync/draft-transfer";
const action = { kind: "update", sourceIdentityKey: "source", listingId: "listing", changes: [{ field: "price", before: 10000, after: 12000 }] } as PlanAction;
const snapshot = { dealer: { id: "dealer", userId: "owner" }, listings: [], identities: [] } as unknown as FingerprintSnapshot;
const live = () => ({ id: "listing", dealerId: "dealer", userId: "owner", status: "LIVE", lifecycleRevision: 3, soldAt: null, expiresAt: null,
  title: "Live title", description: "Live description", price: 10000, categoryId: "car", regionId: "region", attributeValues: [] });
const tx = { stockReviewDraftReceipt: { findUnique: vi.fn(), create: vi.fn() }, listing: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }, listingRevision: { findFirst: vi.fn(), create: vi.fn() }, category: { findFirst: vi.fn() }, region: { findFirst: vi.fn() }, dealerStockSourceIdentity: { updateMany: vi.fn() } };
const run = () => transferStockDrafts(tx as unknown as Prisma.TransactionClient, { reportId: "report", fingerprint: "fingerprint", snapshot, actions: [action], indexes: [0] });
beforeEach(() => {
  vi.clearAllMocks(); tx.stockReviewDraftReceipt.findUnique.mockResolvedValue(null); tx.listing.findUnique.mockResolvedValue(live());
  tx.listingRevision.findFirst.mockResolvedValue(null); tx.listingRevision.create.mockResolvedValue({ id: "revision" }); tx.listing.updateMany.mockResolvedValue({ count: 1 });
});
describe("stock draft transfer", () => {
  it("keeps live content intact and copies changes and owned images into a revision", async () => {
    expect(await run()).toEqual([{ listingId: "listing", revisionId: "revision" }]);
    expect(tx.listing.updateMany).toHaveBeenCalledWith({ where: { id: "listing", status: "LIVE", lifecycleRevision: 3 }, data: { lifecycleRevision: { increment: 1 } } });
    expect(tx.listingRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ price: 12000, title: "Live title", status: "DRAFT", trustDeclarationAccepted: false }) });
    expect(clone).toHaveBeenCalledWith(tx, "listing", "revision");
    expect(tx.listing.create).not.toHaveBeenCalled();
    expect(tx.stockReviewDraftReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionKey: "fingerprint:0", userId: "owner", revisionId: "revision" }) });
  });
  it("returns an existing receipt without duplicating a draft", async () => {
    tx.stockReviewDraftReceipt.findUnique.mockResolvedValue({ listingId: "listing", revisionId: "revision" });
    expect(await run()).toEqual([{ listingId: "listing", revisionId: "revision" }]);
    expect(tx.listing.findUnique).not.toHaveBeenCalled(); expect(tx.listingRevision.create).not.toHaveBeenCalled();
  });
  it.each([{ userId: "other" }, { dealerId: "other" }, { status: "SOLD" }, { soldAt: new Date() }, { expiresAt: new Date(0) }])("refuses foreign or protected stock: %j", async override => {
    tx.listing.findUnique.mockResolvedValue({ ...live(), ...override });
    await expect(run()).rejects.toThrow(); expect(tx.listingRevision.create).not.toHaveBeenCalled();
  });
  it("does not overwrite an existing open revision", async () => {
    tx.listingRevision.findFirst.mockResolvedValue({ id: "existing" });
    await expect(run()).rejects.toThrow(/already/); expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
  it("refuses to create a revision after losing the listing fence", async () => {
    tx.listing.updateMany.mockResolvedValue({ count: 0 });
    await expect(run()).rejects.toThrow(/changed/); expect(tx.listingRevision.create).not.toHaveBeenCalled();
  });
  it("creates incomplete blocked drafts without treating source images as owned", async () => {
    tx.category.findFirst.mockResolvedValue({ id: "car", attributeDefinitions: [] });
    tx.region.findFirst.mockResolvedValue({ id: "region" }); tx.listing.create.mockResolvedValue({ id: "new-draft" });
    tx.dealerStockSourceIdentity.updateMany.mockResolvedValue({ count: 1 });
    const blocked = { kind: "blocked", sourceIdentityKey: "source", listingId: null, reason: "missing-price", section: "new" } as PlanAction;
    await transferStockDrafts(tx as unknown as Prisma.TransactionClient, { reportId: "report", fingerprint: "fp", indexes: [0], actions: [blocked],
      snapshot: { ...snapshot, dealer: { ...snapshot.dealer, regionId: "region" }, identities: [{ sourceIdentityKey: "source", listingId: null }] } as FingerprintSnapshot });
    const data = tx.listing.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", price: 0, trustDeclarationAccepted: false, reviewSourceIdentity: "source" });
    expect(data.images).toBeUndefined();
    expect(tx.stockReviewDraftReceipt.create.mock.calls[0][0].data.blockers).toEqual(expect.arrayContaining(["missing-price", "confirm-vehicle-category", "supply-owned-photos"]));
  });
  it("preserves validated import photos and claims their cleanup receipts atomically", async () => {
    tx.category.findFirst.mockResolvedValue({ id: "car", attributeDefinitions: [] });
    tx.region.findFirst.mockResolvedValue({ id: "region" }); tx.listing.create.mockResolvedValue({ id: "new-draft" });
    tx.dealerStockSourceIdentity.updateMany.mockResolvedValue({ count: 1 });
    const image = { provider: "IMAGEKIT", publicId: "iommarket/listings/import/dealer/vehicle/attempt/0", imageKitFileId: "file", imageKitFilePath: "/iommarket-media/local/imports/import/dealer/vehicle/attempt/0.jpg", cleanupReceiptId: "cleanup", url: "imagekit-private:/iommarket-media/local/imports/import/dealer/vehicle/attempt/0.jpg", width: 1000, height: 700, order: 0 };
    const created = { kind: "create", sourceIdentityKey: "source", listingId: null, title: "Vehicle", description: "Details", pricePence: 1000, categorySlug: "car", attributes: {}, ownedImages: [image] } as PlanAction;
    const input = { reportId: "report", fingerprint: "fp", indexes: [0], actions: [created], snapshot: { ...snapshot, dealer: { ...snapshot.dealer, regionId: "region" }, identities: [{ sourceIdentityKey: "source", listingId: null }] } as FingerprintSnapshot };
    await transferStockDrafts(tx as unknown as Prisma.TransactionClient, input);
    expect(claim).toHaveBeenCalledWith(tx, [image]);
    expect(tx.listing.create.mock.calls[0][0].data.images.create[0]).toMatchObject({ publicId: image.publicId, imageKitFileId: "file" });
    tx.listing.create.mockClear();
    (created as { ownedImages: unknown[] }).ownedImages = [{ ...image, url: "https://dealer.example/photo.jpg" }];
    await expect(transferStockDrafts(tx as unknown as Prisma.TransactionClient, input)).rejects.toThrow(/ownership/);
    expect(tx.listing.create).not.toHaveBeenCalled();
  });
});

