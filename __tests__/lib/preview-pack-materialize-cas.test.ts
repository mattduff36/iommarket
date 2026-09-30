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
  assertPreviewPackSourceCanAdvance,
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

  it("reuses a review listing by source identity when empty images are allowed", async () => {
    const listingCreate = vi.fn();
    const tx = {
      $executeRaw: vi.fn(),
      dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue({ id: "pack-1" }) },
      listing: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing-review" }),
        create: listingCreate,
      },
    };
    await expect(insertPreviewListing(tx as never, {
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      dealerKey: "athol-garage",
      sourceRunId: "run-1",
      identityKey: "stockId:1",
      listing: {} as never,
      images: [],
      catalog: { categories: {}, regionId: "region-1", attributes: [] },
      allowEmptyImages: true,
      review: {
        state: "NEEDS_REVIEW",
        reasons: ["listing-has-no-valid-source-image"],
        sourceIdentity: "stockId:1",
        sourceUrl: null,
      },
    })).resolves.toBe("existing-review");
    expect(listingCreate).not.toHaveBeenCalled();
  });

  it("creates a zero-image review listing with durable review metadata", async () => {
    const listingCreate = vi.fn().mockResolvedValue({ id: "review-created" });
    const tx = {
      $executeRaw: vi.fn(),
      dealerPreviewPack: { findFirst: vi.fn().mockResolvedValue({ id: "pack-1" }) },
      listing: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: listingCreate,
      },
      listingAttributeValue: { createMany: vi.fn() },
      listingImage: { createMany: vi.fn() },
    };
    await expect(insertPreviewListing(tx as never, {
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      dealerKey: "athol-garage",
      sourceRunId: "run-1",
      identityKey: "stockId:2",
      listing: {
        title: "Review car",
        description: "A complete review listing description.",
        pricePence: 100_000,
        categorySlug: "car",
        attributes: {},
        imageUrls: [],
      },
      images: [],
      catalog: { categories: { car: "category-1" }, regionId: "region-1", attributes: [] },
      allowEmptyImages: true,
      review: {
        state: "NEEDS_REVIEW",
        reasons: ["listing-has-no-valid-source-image"],
        sourceIdentity: "stockId:2",
        sourceUrl: "https://dealer.example/stock/2",
      },
    })).resolves.toBe("review-created");
    expect(listingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewState: "NEEDS_REVIEW",
        reviewReasons: ["listing-has-no-valid-source-image"],
        reviewSourceIdentity: "stockId:2",
        reviewSourceUrl: "https://dealer.example/stock/2",
      }),
    });
    expect(tx.listingImage.createMany).not.toHaveBeenCalled();
  });
});

describe("preview pack source ownership", () => {
  it("allows a hidden empty pack to adopt a newer archive run", () => {
    expect(() =>
      assertPreviewPackSourceCanAdvance({
        currentRunId: "run-old",
        nextRunId: "run-new",
        enabled: false,
        listingCount: 0,
      }),
    ).not.toThrow();
  });

  it.each([
    { enabled: true, listingCount: 0 },
    { enabled: false, listingCount: 1 },
  ])("refuses to rebase a loaded pack: %o", ({ enabled, listingCount }) => {
    expect(() =>
      assertPreviewPackSourceCanAdvance({
        currentRunId: "run-old",
        nextRunId: "run-new",
        enabled,
        listingCount,
      }),
    ).toThrow("existing pack belongs to a different source run");
  });
});
