import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  revalidatePathMock,
  logAdminActionMock,
  listingImageFindUnique,
  listingImageDelete,
  listingImageFindMany,
  listingImageUpdate,
  listingUpdateMany,
  cleanupCreate,
  transaction,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  listingImageFindUnique: vi.fn(),
  listingImageDelete: vi.fn(),
  listingImageFindMany: vi.fn(),
  listingImageUpdate: vi.fn(),
  listingUpdateMany: vi.fn(),
  cleanupCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transaction,
  },
}));

import { adminDeleteImage } from "@/actions/admin/media";

const remainingImage = {
  id: "img-2",
  listingId: "listing-1",
  order: 1,
};

describe("adminDeleteImage PHOTO-ADMIN-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    listingImageFindUnique.mockResolvedValue({
      id: "img-1",
      listingId: "listing-1",
      publicId: "iommarket/listings/one",
      provider: "CLOUDINARY",
    });
    listingImageDelete.mockResolvedValue({});
    listingImageFindMany.mockResolvedValue([remainingImage]);
    listingImageUpdate.mockResolvedValue(remainingImage);
    listingUpdateMany.mockResolvedValue({ count: 1 });
    cleanupCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        listingImage: {
          findUnique: listingImageFindUnique,
          delete: listingImageDelete,
          findMany: listingImageFindMany,
          update: listingImageUpdate,
        },
        listing: {
          updateMany: listingUpdateMany,
        },
        listingImageCleanupJob: {
          create: cleanupCreate,
        },
      }),
    );
  });

  it("refuses to delete images from a live listing inside the write transaction", async () => {
    listingUpdateMany.mockResolvedValue({ count: 0 });

    await expect(adminDeleteImage("img-1")).resolves.toEqual({
      error: "Take the listing down before deleting images from a live or sold listing.",
    });
    expect(listingImageDelete).not.toHaveBeenCalled();
    expect(cleanupCreate).not.toHaveBeenCalled();
  });

  it("refuses to delete images from a sold listing ALR-CMS-001", async () => {
    listingUpdateMany.mockResolvedValue({ count: 0 });

    await expect(adminDeleteImage("img-1")).resolves.toEqual({
      error: "Take the listing down before deleting images from a live or sold listing.",
    });
    expect(listingImageDelete).not.toHaveBeenCalled();
  });

  it("compacts remaining order, bumps photoRevision, and enqueues cleanup", async () => {
    await expect(adminDeleteImage("img-1")).resolves.toEqual({
      data: { deleted: true },
    });

    expect(listingUpdateMany).toHaveBeenCalledWith({
      where: { id: "listing-1", status: { notIn: ["LIVE", "SOLD"] } },
      data: { photoRevision: { increment: 1 } },
    });
    expect(listingImageUpdate).toHaveBeenCalledWith({
      where: { id: "img-2" },
      data: { order: remainingImage.order + 10_000 },
    });
    expect(listingImageUpdate).toHaveBeenCalledWith({
      where: { id: "img-2" },
      data: { order: 0 },
    });
    expect(cleanupCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publicId: "iommarket/listings/one",
        reason: "admin-deleted",
      }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE_IMAGE",
        entityId: "img-1",
      }),
    );
  });
});
