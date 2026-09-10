import { describe, expect, it, vi } from "vitest";
import {
  canEnqueuePreviewPackCleanup,
  matchArchivePreviewRepairItems,
  matchOceanPreviewRepairItems,
  swapPreviewListingImages,
  uploadAndSwapPreviewRepairItem,
} from "@/lib/preview-packs/repair-images";
import { previewImagePublicId } from "@/lib/preview-packs/upload";

describe("preview pack image repair", () => {
  it("never enqueues production import or repair public IDs", () => {
    expect(canEnqueuePreviewPackCleanup("iommarket/listings/preview-packs/rex/car/0")).toBe(true);
    expect(canEnqueuePreviewPackCleanup("iommarket/listings/import/dealer/20892856/0")).toBe(false);
    expect(canEnqueuePreviewPackCleanup("iommarket/listings/repair/run/listing/0")).toBe(false);
  });

  it("matches archive vehicles to existing listings and skips creates", () => {
    const publicId = previewImagePublicId(
      "rex-motor-company",
      "car-1",
      "attempt-1",
      0,
    );
    const planned = matchArchivePreviewRepairItems({
      dealerKey: "rex-motor-company",
      vehicles: [
        {
          identityKey: "car-1",
          title: "2023 Citroën C3",
          pricePence: 1_000_000,
          mileage: "10000",
          sources: [{ localPath: null, url: "https://s3.example/rexmotors/img_1.jpeg" }],
        },
        {
          identityKey: "car-missing",
          title: "Missing car",
          pricePence: 2_000_000,
          mileage: "1",
          sources: [{ localPath: null, url: "https://s3.example/rexmotors/img_2.jpeg" }],
        },
      ],
      listings: [
        {
          id: "listing-1",
          title: "2023 Citroën C3",
          pricePence: 1_000_000,
          mileage: "10000",
          previewPackId: "pack-1",
          dealerId: "dealer-1",
          status: "ADMIN_PREVIEW",
          photoRevision: 1,
          images: [{ publicId, order: 0 }],
        },
      ],
    });
    expect(planned.items).toHaveLength(1);
    expect(planned.items[0]?.listingId).toBe("listing-1");
    expect(planned.skipped).toEqual([{ title: "Missing car", reason: "no-listing" }]);
  });

  it("matches Ocean preview listings by title, price, and mileage", () => {
    const planned = matchOceanPreviewRepairItems({
      listings: [
        {
          id: "omv-1",
          title: "2024 SEAT Ibiza",
          pricePence: 1_500_000,
          mileage: "5000",
          previewPackId: "pack-ocean",
          dealerId: "dealer-ocean",
          status: "ADMIN_PREVIEW",
          photoRevision: 2,
          images: [{ publicId: "iommarket/listings/import/x/0", order: 0 }],
        },
      ],
      vehicles: [
        {
          title: "2024 SEAT Ibiza",
          pricePence: 1_500_000,
          mileage: "5000",
          imageUrls: [
            "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/a.jpg",
          ],
        },
        {
          title: "Unseen van",
          pricePence: 9,
          mileage: "1",
          imageUrls: ["https://s3.example/van.jpg"],
        },
      ],
    });
    expect(planned.items).toHaveLength(1);
    expect(planned.items[0]?.oldPublicIds[0]).toContain("/import/");
    expect(planned.skipped.map((row) => row.reason)).toEqual(["unmatched"]);
  });

  it("PREVIEW-MATCH-001 rejects duplicate source fingerprints", () => {
    const baseVehicle = {
      title: "2024 SEAT Ibiza",
      pricePence: 1_500_000,
      mileage: "5000",
      imageUrls: ["https://images.example/a.jpg"],
    };
    const planned = matchOceanPreviewRepairItems({
      listings: [{
        id: "omv-1",
        title: baseVehicle.title,
        pricePence: baseVehicle.pricePence,
        mileage: baseVehicle.mileage,
        previewPackId: "pack-ocean",
        dealerId: "dealer-ocean",
        status: "ADMIN_PREVIEW",
        photoRevision: 2,
        images: [{ publicId: "iommarket/listings/import/x/0", order: 0 }],
      }],
      vehicles: [baseVehicle, { ...baseVehicle }],
    });
    expect(planned.items).toEqual([]);
    expect(planned.skipped.filter((row) => row.reason === "ambiguous-source")).toHaveLength(2);
  });

  it("swaps images and only cleans preview-pack public IDs", async () => {
    const createMany = vi.fn();
    const deleteMany = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const oldPublicIds = [
      "iommarket/listings/preview-packs/rex/car/0",
      "iommarket/listings/preview-packs/rex/car/1",
      "iommarket/listings/import/dealer/1/0",
    ];
    const prisma = {
      $transaction: async (fn: (tx: {
        listingImage: { deleteMany: typeof deleteMany; createMany: typeof createMany };
        listing: { findFirst: ReturnType<typeof vi.fn>; updateMany: typeof updateMany };
        dealerPreviewPack: { findFirst: ReturnType<typeof vi.fn> };
        listingImageCleanupJob: { createMany: typeof createMany };
      }) => Promise<void>) =>
        fn({
          listingImage: { deleteMany, createMany },
          listing: {
            findFirst: vi.fn().mockResolvedValue({
              images: oldPublicIds.map((publicId, order) => ({ publicId, order })),
              revisions: [],
            }),
            updateMany,
          },
          dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue({ id: "pack-1" }) },
          listingImageCleanupJob: { createMany },
        }),
    };
    const result = await swapPreviewListingImages({
      prisma: prisma as never,
      listingId: "listing-1",
      oldPublicIds,
      previewPackId: "pack-1",
      dealerId: "dealer-1",
      dealerKey: "rex-motor-company",
      sourceRunId: "run-1",
      expectedPhotoRevision: 1,
      uploaded: [
        {
          url: "https://res.cloudinary.com/demo/image/private/new",
          publicId: "iommarket/listings/preview-packs/rex/car/0",
          order: 0,
          provider: "CLOUDINARY",
          assetId: "a",
          version: "1",
          width: 1600,
          height: 1200,
          format: "jpg",
          bytes: 40_000,
          ownership: null,
        },
      ],
      reason: "preview-pack-image-repair:rex-motor-company",
    });
    expect(result.enqueuedCleanup).toEqual(["iommarket/listings/preview-packs/rex/car/1"]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { listingId: "listing-1" } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        previewPackId: "pack-1",
        dealerId: "dealer-1",
        photoRevision: 1,
      }),
    }));
  });

  it("PREVIEW-GALLERY-001 cleans partial uploads without swapping the listing", async () => {
    const cleanupImages = vi.fn();
    const uploaded = {
      url: "https://res.cloudinary.com/demo/image/private/new",
      publicId: "iommarket/listings/preview-packs/rex/car/attempt/0",
      order: 0,
      provider: "CLOUDINARY" as const,
      assetId: "asset",
      version: "1",
      width: 1600,
      height: 1200,
      format: "jpg",
      bytes: 80_000,
      ownership: null,
    };
    const result = await uploadAndSwapPreviewRepairItem({
      prisma: {} as never,
      dealerKey: "rex-motor-company",
      reason: "test",
      item: {
        listingId: "listing-1",
        title: "Car",
        identityKey: "car",
        sources: [
          { localPath: null, url: "https://images.example/one.jpg" },
          { localPath: null, url: "https://images.example/two.jpg" },
        ],
        oldPublicIds: [
          "iommarket/listings/preview-packs/rex/car/0",
          "iommarket/listings/preview-packs/rex/car/1",
          "iommarket/listings/preview-packs/rex/car/2",
          "iommarket/listings/preview-packs/rex/car/3",
        ],
        previewPackId: "pack-1",
        dealerId: "dealer-1",
        dealerKey: "rex-motor-company",
        sourceRunId: "run-1",
        expectedPhotoRevision: 1,
      },
      uploadImages: vi.fn().mockResolvedValue([uploaded]),
      cleanupImages,
    });
    expect(result).toEqual(expect.objectContaining({
      repaired: false,
      reason: "upload-incomplete",
    }));
    expect(cleanupImages).toHaveBeenCalledWith([uploaded]);
  });

  it("PREVIEW-CAS-001 cleans immutable uploads when pack or listing state changed", async () => {
    const cleanupImages = vi.fn();
    const uploads = Array.from({ length: 4 }, (_, order) => ({
      url: `https://res.cloudinary.com/demo/image/private/new-${order}`,
      publicId: `iommarket/listings/preview-packs/rex/car/attempt/${order}`,
      order,
      provider: "CLOUDINARY" as const,
      assetId: `asset-${order}`,
      version: "1",
      width: 1600,
      height: 1200,
      format: "jpg",
      bytes: 80_000,
      ownership: null,
    }));
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue(null) },
          listing: { findFirst: vi.fn(), updateMany: vi.fn() },
        }),
    };
    const result = await uploadAndSwapPreviewRepairItem({
      prisma: prisma as never,
      dealerKey: "rex-motor-company",
      reason: "test",
      item: {
        listingId: "listing-1",
        title: "Car",
        identityKey: "car",
        sources: uploads.map((_, order) => ({
          localPath: null,
          url: `https://images.example/${order}.jpg`,
        })),
        oldPublicIds: Array.from(
          { length: 4 },
          (_, order) => `iommarket/listings/preview-packs/rex/car/${order}`,
        ),
        previewPackId: "pack-1",
        dealerId: "dealer-1",
        dealerKey: "rex-motor-company",
        sourceRunId: "run-1",
        expectedPhotoRevision: 1,
      },
      uploadImages: vi.fn().mockResolvedValue(uploads),
      cleanupImages,
    });
    expect(result).toEqual(expect.objectContaining({
      repaired: false,
      reason: "listing-changed",
    }));
    expect(cleanupImages).toHaveBeenCalledWith(uploads);
  });
});
