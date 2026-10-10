import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupFindMany: vi.fn(),
  cleanupUpdateMany: vi.fn(),
  listingImageFindFirst: vi.fn(),
  revisionImageFindFirst: vi.fn(),
  deleteImage: vi.fn(),
  deleteDisposable: vi.fn(),
  managedCleanup: vi.fn(),
  blocked: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    listingImageCleanupJob: {
      findMany: mocks.cleanupFindMany,
      updateMany: mocks.cleanupUpdateMany,
    },
    listingImage: { findFirst: mocks.listingImageFindFirst },
    listingRevisionImage: { findFirst: mocks.revisionImageFindFirst },
  },
}));
vi.mock("@/lib/upload/cloudinary", () => ({ deleteImage: mocks.deleteImage }));
vi.mock("@/lib/media/disposable-media", () => ({ deleteDisposableImageKitFile: mocks.deleteDisposable }));
vi.mock("@/lib/media/managed-cleanup", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media/managed-cleanup")>("@/lib/media/managed-cleanup");
  return { ...actual, processManagedCleanupReceipt: mocks.managedCleanup };
});
vi.mock("@/lib/database-sync/effects", () => ({
  externalEffectBlocked: mocks.blocked,
  assertExternalEffectAllowed: vi.fn(),
}));

import { processListingImageCleanupJobs } from "@/lib/listings/photo-cleanup";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    publicId: "iommarket/listings/staging/user/photo",
    deliveryType: "private",
    imageKitFileId: null as string | null,
    imageKitFilePath: null as string | null,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("cloned media cleanup isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanupUpdateMany.mockResolvedValue({ count: 1 });
    mocks.listingImageFindFirst.mockResolvedValue(null);
    mocks.revisionImageFindFirst.mockResolvedValue(null);
    mocks.deleteImage.mockResolvedValue(undefined);
    mocks.deleteDisposable.mockResolvedValue(undefined);
    mocks.managedCleanup.mockResolvedValue({ status: "deleted" });
    mocks.blocked.mockResolvedValue(false);
  });

  it("completes copied production managed and legacy targets locally without provider calls", async () => {
    const managed = job({
      id: "cloned-managed",
      publicId: "imagekit/production/user/intent",
      deliveryType: "imagekit-managed",
      imageKitFileId: "prod-file",
      imageKitFilePath: "/iommarket-media/production/listings/user/intent/photo.jpg",
    });
    const legacy = job({
      id: "cloned-legacy",
      publicId: "iommarket/listings/production/dealer/photo",
      imageKitFileId: "legacy-file",
      imageKitFilePath: "/legacy/production/photo.jpg",
    });
    mocks.blocked.mockResolvedValue(true);
    mocks.cleanupFindMany.mockResolvedValue([managed, legacy]);

    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 2 });

    expect(mocks.blocked).toHaveBeenNthCalledWith(1, {
      mediaIds: [managed.publicId, managed.imageKitFileId, managed.imageKitFilePath],
    });
    expect(mocks.blocked).toHaveBeenNthCalledWith(2, {
      mediaIds: [legacy.publicId, legacy.imageKitFileId, legacy.imageKitFilePath],
    });
    expect(mocks.managedCleanup).not.toHaveBeenCalled();
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.deleteDisposable).not.toHaveBeenCalled();
    expect(mocks.cleanupUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "cloned-managed", attempts: 1 }),
      data: expect.objectContaining({ status: "COMPLETED", lastError: "preserved-original" }),
    });
    expect(mocks.cleanupUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "cloned-legacy", attempts: 1 }),
      data: expect.objectContaining({ status: "COMPLETED", lastError: "preserved-original" }),
    });
  });

  it("still physically cleans a staging-owned managed file and a staging legacy file", async () => {
    const managed = job({
      id: "staging-managed",
      publicId: "imagekit/staging/user/intent",
      deliveryType: "imagekit-managed",
      imageKitFileId: "staging-file",
      imageKitFilePath: "/iommarket-media/staging/listings/user/intent/photo.jpg",
    });
    const legacy = job({ id: "staging-legacy" });
    mocks.cleanupFindMany.mockResolvedValue([managed, legacy]);

    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 2 });

    expect(mocks.managedCleanup).toHaveBeenCalledWith(managed, expect.any(Date));
    expect(mocks.deleteImage).toHaveBeenCalledWith(legacy.publicId, "private");
    expect(mocks.cleanupUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "staging-managed", attempts: 1 }),
      data: expect.objectContaining({ status: "COMPLETED", lastError: null }),
    });
    expect(mocks.deleteDisposable).not.toHaveBeenCalled();
  });

  it("refuses an uncopied production identity and deletes nothing when provenance lookup fails", async () => {
    mocks.cleanupFindMany.mockResolvedValue([job({
      id: "foreign",
      publicId: "iommarket/listings/production/dealer/photo",
    })]);
    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 1 });
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.cleanupUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "foreign", attempts: 1 }),
      data: expect.objectContaining({ status: "FAILED" }),
    });

    mocks.blocked.mockRejectedValue(new Error("provenance lookup failed"));
    mocks.cleanupFindMany.mockResolvedValue([job({
      id: "unknown",
      deliveryType: "imagekit-managed",
      imageKitFileId: "maybe-staging",
      imageKitFilePath: "/iommarket-media/staging/listings/user/intent/photo.jpg",
    })]);
    await expect(processListingImageCleanupJobs()).resolves.toEqual({ processed: 1 });
    expect(mocks.managedCleanup).not.toHaveBeenCalled();
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.deleteDisposable).not.toHaveBeenCalled();
    expect(mocks.cleanupUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "unknown", attempts: 1 }),
      data: expect.objectContaining({ status: "FAILED", lastError: "provenance lookup failed" }),
    });
  });
});
