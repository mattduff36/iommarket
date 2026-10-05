import { describe, expect, it, vi } from "vitest";
import { swapPreviewListingImages } from "@/lib/preview-packs/repair-images";
const publicId = "iommarket/listings/preview-packs/dealer/item/old/0";
const filePath = "/iommarket-media/staging/imports/preview-packs/dealer/item/old/0.jpg";

function setup(image: Record<string, unknown>) {
  const createMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    dealerPreviewPack: { findFirst: vi.fn(async () => ({ id: "pack" })) },
    listing: { findFirst: vi.fn(async () => ({ images: [image], revisions: [] })), updateMany: vi.fn(async () => ({ count: 1 })) },
    listingImage: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    listingImageCleanupJob: { createMany },
  };
  return { createMany, prisma: { $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) } };
}

describe("provider-aware preview repair cleanup", () => {
  it("retains exact managed identity when an imported ImageKit photo is removed", async () => {
    const { prisma, createMany } = setup({ publicId, order: 0, provider: "IMAGEKIT", imageKitFileId: "file", imageKitFilePath: filePath });
    await swapPreviewListingImages({ prisma: prisma as never, listingId: "listing", uploaded: [], oldPublicIds: [publicId], previewPackId: "pack", dealerId: "dealer", dealerKey: "dealer", sourceRunId: "run", expectedPhotoRevision: 1, reason: "repair" });
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ publicId, deliveryType: "imagekit-managed", imageKitFileId: "file", imageKitFilePath: filePath })] });
  });
  it("preserves mapped Cloudinary rollback identity instead of losing the migrated copy", async () => {
    const { prisma, createMany } = setup({ publicId, order: 0, provider: "CLOUDINARY", imageKitFileId: "mapped", imageKitFilePath: "/iommarket-migration/photo.jpg" });
    await swapPreviewListingImages({ prisma: prisma as never, listingId: "listing", uploaded: [], oldPublicIds: [publicId], previewPackId: "pack", dealerId: "dealer", dealerKey: "dealer", sourceRunId: "run", expectedPhotoRevision: 1, reason: "repair" });
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ deliveryType: "private", imageKitFileId: "mapped", imageKitFilePath: "/iommarket-migration/photo.jpg" })] });
  });
});
