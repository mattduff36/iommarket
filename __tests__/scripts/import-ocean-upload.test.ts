import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedListingUpload, deleteImage } = vi.hoisted(() => ({
  createSignedListingUpload: vi.fn((input: { publicId: string }) => ({
    cloudName: "du3othqre",
    apiKey: "key",
    timestamp: 1,
    signature: "signature",
    publicId: input.publicId,
    type: "private",
    transformation: "fl_force_strip",
    overwrite: false,
    uploadUrl: "https://api.cloudinary.test/upload",
  })),
  deleteImage: vi.fn(),
}));

vi.mock("@/lib/upload/cloudinary", () => ({
  createSignedListingUpload,
  deleteImage,
}));

import {
  enqueueImportedListingImageCleanup,
  uploadListingImages,
} from "../../scripts/import-ocean-inventory/upload";

const downloadImpl = vi.fn().mockResolvedValue({
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
  contentType: "image/jpeg",
});

function uploadResponse(publicId: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      public_id: publicId,
      asset_id: `asset:${publicId}`,
      version: 1,
      secure_url: `https://res.cloudinary.com/demo/${publicId}`,
      width: 1600,
      height: 1200,
      bytes: 80_000,
      format: "jpg",
      ...overrides,
    }),
  } as Response;
}

describe("IMPORT-CLEANUP-001 Ocean import image ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteImage.mockResolvedValue(undefined);
  });

  it("uses attempt-scoped IDs and destroys a newly created unusable upload", async () => {
    const publicId = "iommarket/listings/import/user/vehicle/attempt-1/0";
    const fetchImpl = vi.fn().mockResolvedValue(uploadResponse(publicId, {
      width: 10,
      height: 10,
      bytes: 100,
    }));

    await expect(uploadListingImages({
      userId: "user",
      listingKey: "vehicle",
      attemptId: "attempt-1",
      imageUrls: ["https://images.example/one.jpg"],
      downloadImpl,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual([]);

    expect(deleteImage).toHaveBeenCalledWith(publicId, "private");
  });

  it("compensates earlier owned uploads if a later upload fails", async () => {
    const firstId = "iommarket/listings/import/user/vehicle/attempt-2/0";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(uploadResponse(firstId))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "upload failed" } }),
      } as Response);

    await expect(uploadListingImages({
      userId: "user",
      listingKey: "vehicle",
      attemptId: "attempt-2",
      imageUrls: [
        "https://images.example/one.jpg",
        "https://images.example/two.jpg",
      ],
      downloadImpl,
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("upload failed");

    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith(firstId, "private");
  });

  it("ASSET-UNKNOWN-001 never deletes an upload whose ownership response is malformed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        public_id: "iommarket/listings/import/user/vehicle/attempt-3/0",
        width: 1600,
        height: 1200,
        bytes: 80_000,
        format: "jpg",
      }),
    } as Response);

    await expect(uploadListingImages({
      userId: "user",
      listingKey: "vehicle",
      attemptId: "attempt-3",
      imageUrls: ["https://images.example/one.jpg"],
      downloadImpl,
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow(/ownership/);

    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("queues a reference-checked cleanup after a database outcome becomes uncertain", async () => {
    const publicId = "iommarket/listings/import/user/vehicle/attempt-4/0";
    const [image] = await uploadListingImages({
      userId: "user",
      listingKey: "vehicle",
      attemptId: "attempt-4",
      imageUrls: ["https://images.example/one.jpg"],
      downloadImpl,
      fetchImpl: vi.fn().mockResolvedValue(uploadResponse(publicId)) as unknown as typeof fetch,
    });
    const createMany = vi.fn();
    await enqueueImportedListingImageCleanup({
      listingImageCleanupJob: { createMany },
    } as never, [image!], "db-outcome-uncertain");
    expect(createMany).toHaveBeenCalledWith({
      data: [{
        publicId,
        deliveryType: "private",
        reason: "db-outcome-uncertain",
      }],
    });
    expect(deleteImage).not.toHaveBeenCalled();
  });
});
