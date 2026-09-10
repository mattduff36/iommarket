import { describe, expect, it, vi } from "vitest";

const {
  packFindFirst,
  listingFindFirst,
  listingUpdateMany,
  imageCreateMany,
} = vi.hoisted(() => ({
  packFindFirst: vi.fn(),
  listingFindFirst: vi.fn(),
  listingUpdateMany: vi.fn(),
  imageCreateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        dealerPreviewPack: { findFirst: packFindFirst },
        listing: {
          findFirst: listingFindFirst,
          updateMany: listingUpdateMany,
        },
        listingImage: { createMany: imageCreateMany },
      }),
  },
}));

import {
  attachPreviewImages,
  insertPreviewListing,
} from "@/lib/preview-packs/materialize";

describe("MATERIALIZER-RACE-001 preview image backfill CAS", () => {
  it("does not attach images if the pack source run changed", async () => {
    packFindFirst.mockResolvedValue(null);
    listingFindFirst.mockResolvedValue({
      images: [],
      revisions: [],
    });
    await expect(attachPreviewImages({
      listingId: "listing-1",
      previewPackId: "pack-1",
      dealerId: "dealer-1",
      dealerKey: "rex-motor-company",
      sourceRunId: "run-1",
      expectedPhotoRevision: 0,
      expectedPublicIds: [],
      images: [{
        url: "https://res.cloudinary.com/demo/new",
        publicId: "iommarket/listings/preview-packs/rex/car/attempt/0",
        order: 0,
        provider: "CLOUDINARY",
        assetId: "asset",
        version: "1",
        width: 1600,
        height: 1200,
        format: "jpg",
        bytes: 80_000,
        ownership: null,
      }],
    })).resolves.toBe(false);
    expect(listingUpdateMany).not.toHaveBeenCalled();
    expect(imageCreateMany).not.toHaveBeenCalled();
  });

  it("validates and locks the pack before creating a preview listing", async () => {
    const listingCreate = vi.fn();
    const tx = {
      $executeRaw: vi.fn(),
      dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue(null) },
      listing: { findFirst: vi.fn(), create: listingCreate },
    };
    await expect(insertPreviewListing(tx as never, {
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      dealerKey: "rex-motor-company",
      sourceRunId: "run-1",
      identityKey: "car-1",
      listing: {} as never,
      images: [],
      catalog: { categories: {}, regionId: "region-1", attributes: [] },
    })).resolves.toBeNull();
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(listingCreate).not.toHaveBeenCalled();
  });

  it("refuses zero-image creates so identity deduplication cannot be bypassed", async () => {
    const listingCreate = vi.fn();
    const tx = {
      $executeRaw: vi.fn(),
      dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue({ id: "pack-1" }) },
      listing: { findFirst: vi.fn(), create: listingCreate },
    };
    await expect(insertPreviewListing(tx as never, {
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      dealerKey: "rex-motor-company",
      sourceRunId: "run-1",
      identityKey: "car-1",
      listing: {} as never,
      images: [],
      catalog: { categories: {}, regionId: "region-1", attributes: [] },
    })).resolves.toBeNull();
    expect(listingCreate).not.toHaveBeenCalled();
  });
});
