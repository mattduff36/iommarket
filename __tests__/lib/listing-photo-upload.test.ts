import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  intentFindUnique,
  intentUpdateMany,
  cleanupCreate,
  getCloudinaryResource,
} = vi.hoisted(() => ({
  intentFindUnique: vi.fn(),
  intentUpdateMany: vi.fn(),
  cleanupCreate: vi.fn(),
  getCloudinaryResource: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const listingImageUploadIntent = {
    findUnique: intentFindUnique,
    updateMany: intentUpdateMany,
  };
  const listingImageCleanupJob = {
    create: cleanupCreate,
  };
  return {
    db: {
      listingImageUploadIntent,
      listingImageCleanupJob,
      $transaction: async (
        callback: (tx: {
          listingImageUploadIntent: typeof listingImageUploadIntent;
          listingImageCleanupJob: typeof listingImageCleanupJob;
        }) => Promise<unknown>,
      ) => callback({ listingImageUploadIntent, listingImageCleanupJob }),
    },
  };
});

vi.mock("@/lib/upload/cloudinary", () => ({
  createSignedListingUpload: vi.fn(),
  getCloudinaryResource,
}));

import { finalizeListingImageUploadIntent } from "@/lib/listings/photo-upload";

const issuedIntent = {
  id: "intent-1",
  userId: "user-1",
  publicId: "iommarket/listings/staging/user-1/intent-1",
  status: "ISSUED",
  expiresAt: new Date(Date.now() + 60_000),
};

describe("PHOTO-TRUST-001 listing upload finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intentFindUnique.mockResolvedValue(issuedIntent);
    intentUpdateMany.mockResolvedValue({ count: 1 });
    cleanupCreate.mockResolvedValue({});
  });

  it("persists only authoritative Cloudinary metadata", async () => {
    getCloudinaryResource.mockResolvedValue({
      assetId: "asset-1",
      publicId: issuedIntent.publicId,
      version: "99",
      width: 1600,
      height: 1000,
      format: "jpg",
      bytes: 12345,
      resourceType: "image",
      type: "private",
    });

    const result = await finalizeListingImageUploadIntent({
      userId: "user-1",
      intentId: "intent-1",
      publicId: issuedIntent.publicId,
      assetId: "forged-asset",
      version: "1",
    });

    expect(result.error).toMatch(/does not match/i);
    expect(intentUpdateMany).toHaveBeenCalledWith({
      where: { id: "intent-1", status: "ISSUED", image: { is: null } },
      data: { status: "REJECTED" },
    });
    expect(cleanupCreate).toHaveBeenCalled();

    getCloudinaryResource.mockResolvedValue({
      assetId: "asset-1",
      publicId: issuedIntent.publicId,
      version: "99",
      width: 1600,
      height: 1000,
      format: "jpg",
      bytes: 12345,
      resourceType: "image",
      type: "private",
    });

    const accepted = await finalizeListingImageUploadIntent({
      userId: "user-1",
      intentId: "intent-1",
      publicId: issuedIntent.publicId,
      assetId: "asset-1",
      version: "99",
    });

    expect(accepted.data).toMatchObject({
      status: "VERIFIED",
      assetId: "asset-1",
      version: "99",
      width: 1600,
      height: 1000,
    });
    expect(intentUpdateMany).toHaveBeenCalledWith({
      where: { id: "intent-1", status: "ISSUED", userId: "user-1" },
      data: expect.objectContaining({
        status: "VERIFIED",
        assetId: "asset-1",
        version: "99",
      }),
    });
  });

  it("treats a lost finalize race as already verified when another request won", async () => {
    getCloudinaryResource.mockResolvedValue({
      assetId: "asset-1",
      publicId: issuedIntent.publicId,
      version: "99",
      width: 1600,
      height: 1000,
      format: "jpg",
      bytes: 12345,
      resourceType: "image",
      type: "private",
    });
    intentUpdateMany.mockResolvedValue({ count: 0 });
    intentFindUnique
      .mockResolvedValueOnce(issuedIntent)
      .mockResolvedValueOnce({
        ...issuedIntent,
        status: "VERIFIED",
        assetId: "asset-1",
        version: "99",
      });

    await expect(
      finalizeListingImageUploadIntent({
        userId: "user-1",
        intentId: "intent-1",
        publicId: issuedIntent.publicId,
      }),
    ).resolves.toMatchObject({
      data: { status: "VERIFIED", assetId: "asset-1" },
    });
  });

  it("does not expire or delete an issued intent that already has an attached image", async () => {
    intentFindUnique.mockResolvedValue({
      ...issuedIntent,
      expiresAt: new Date(Date.now() - 1_000),
    });
    intentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      finalizeListingImageUploadIntent({
        userId: "user-1",
        intentId: "intent-1",
        publicId: issuedIntent.publicId,
      }),
    ).resolves.toEqual({ error: "This upload expired. Please try again." });

    expect(intentUpdateMany).toHaveBeenCalledWith({
      where: { id: "intent-1", status: "ISSUED", image: { is: null } },
      data: { status: "EXPIRED" },
    });
    expect(cleanupCreate).not.toHaveBeenCalled();
  });

  it("rejects non-images, public delivery types and undersized files", async () => {
    getCloudinaryResource.mockResolvedValue({
      assetId: "asset-1",
      publicId: issuedIntent.publicId,
      version: "99",
      width: 1600,
      height: 1000,
      format: "jpg",
      bytes: 12345,
      resourceType: "raw",
      type: "upload",
    });

    await expect(
      finalizeListingImageUploadIntent({
        userId: "user-1",
        intentId: "intent-1",
        publicId: issuedIntent.publicId,
      }),
    ).resolves.toEqual({ error: "Only private listing images can be saved." });

    getCloudinaryResource.mockResolvedValue({
      assetId: "asset-1",
      publicId: issuedIntent.publicId,
      version: "99",
      width: 400,
      height: 300,
      format: "heic",
      bytes: 12345,
      resourceType: "image",
      type: "private",
    });

    await expect(
      finalizeListingImageUploadIntent({
        userId: "user-1",
        intentId: "intent-1",
        publicId: issuedIntent.publicId,
      }),
    ).resolves.toMatchObject({
      error: expect.stringMatching(/800/),
    });
  });
});
