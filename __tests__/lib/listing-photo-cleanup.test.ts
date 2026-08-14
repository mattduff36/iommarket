import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  intentFindMany,
  intentUpdateMany,
  cleanupCreate,
  cleanupFindMany,
  cleanupUpdate,
  cleanupUpdateMany,
  deleteImage,
} = vi.hoisted(() => ({
  intentFindMany: vi.fn(),
  intentUpdateMany: vi.fn(),
  cleanupCreate: vi.fn(),
  cleanupFindMany: vi.fn(),
  cleanupUpdate: vi.fn(),
  cleanupUpdateMany: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const listingImageUploadIntent = {
    findMany: intentFindMany,
    updateMany: intentUpdateMany,
  };
  const listingImageCleanupJob = {
    create: cleanupCreate,
    findMany: cleanupFindMany,
    update: cleanupUpdate,
    updateMany: cleanupUpdateMany,
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
  deleteImage,
}));

import {
  expireAbandonedListingImageIntents,
  processListingImageCleanupJobs,
} from "@/lib/listings/photo-cleanup";

describe("PHOTO-ORPHAN-001 listing photo cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intentUpdateMany.mockResolvedValue({ count: 1 });
    cleanupCreate.mockResolvedValue({});
    cleanupUpdate.mockResolvedValue({});
    cleanupUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("expires abandoned verified intents and queues deletion", async () => {
    intentFindMany.mockResolvedValue([
      {
        id: "intent-1",
        publicId: "iommarket/listings/staging/user/one",
        deliveryType: "private",
        status: "VERIFIED",
      },
      {
        id: "intent-2",
        publicId: "iommarket/listings/staging/user/two",
        deliveryType: "private",
        status: "ISSUED",
      },
    ]);

    await expect(expireAbandonedListingImageIntents()).resolves.toEqual({ expired: 2 });
    expect(cleanupCreate).toHaveBeenCalledTimes(2);
    expect(cleanupCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publicId: "iommarket/listings/staging/user/one",
        reason: "expired-intent",
      }),
    });
    expect(intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "intent-1",
        status: { in: ["ISSUED", "VERIFIED"] },
        image: { is: null },
      }),
      data: { status: "EXPIRED" },
    });
  });

  it("does not delete an asset if the intent was consumed before expiry committed", async () => {
    intentFindMany.mockResolvedValue([
      {
        id: "intent-1",
        publicId: "iommarket/listings/staging/user/one",
        deliveryType: "private",
        status: "VERIFIED",
      },
    ]);
    intentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(expireAbandonedListingImageIntents()).resolves.toEqual({ expired: 0 });
    expect(cleanupCreate).not.toHaveBeenCalled();
  });

  it("retries failed cleanup jobs that still have attempts remaining", async () => {
    cleanupFindMany.mockResolvedValue([
      {
        id: "job-retry",
        publicId: "iommarket/listings/retry",
        deliveryType: "private",
        status: "FAILED",
        attempts: 2,
      },
    ]);
    deleteImage.mockResolvedValue(undefined);

    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 1 });
    expect(cleanupUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "job-retry" }),
      data: { attempts: { increment: 1 } },
    });
    expect(cleanupUpdate).toHaveBeenCalledWith({
      where: { id: "job-retry" },
      data: expect.objectContaining({
        status: "COMPLETED",
        lastError: null,
      }),
    });
  });

  it("completes cleanup jobs idempotently when Cloudinary already deleted the asset", async () => {
    cleanupFindMany.mockResolvedValue([
      {
        id: "job-1",
        publicId: "iommarket/listings/gone",
        deliveryType: "private",
      },
    ]);
    deleteImage.mockRejectedValue(new Error("Resource not found"));

    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 1 });
    expect(cleanupUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
      }),
    });
  });
});
