import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listingFindUnique,
  listingUpdateMany,
  revisionFindUnique,
  revisionUpdateMany,
  revisionImageUpdate,
  revisionImageDeleteMany,
  transaction,
  mockDb,
} = vi.hoisted(() => {
  const listingFindUnique = vi.fn();
  const listingUpdateMany = vi.fn();
  const revisionFindUnique = vi.fn();
  const revisionUpdateMany = vi.fn();
  const revisionImageUpdate = vi.fn();
  const revisionImageDeleteMany = vi.fn();
  const transaction = vi.fn();
  const mockDb = {
    listing: {
      findUnique: listingFindUnique,
      updateMany: listingUpdateMany,
    },
    listingRevision: {
      findUnique: revisionFindUnique,
      updateMany: revisionUpdateMany,
    },
    listingRevisionImage: {
      update: revisionImageUpdate,
      deleteMany: revisionImageDeleteMany,
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    listingImage: {
      count: vi.fn(),
    },
    listingImageUploadIntent: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    listingImageCleanupJob: {
      create: vi.fn(),
    },
    $transaction: transaction,
  };
  return {
    listingFindUnique,
    listingUpdateMany,
    revisionFindUnique,
    revisionUpdateMany,
    revisionImageUpdate,
    revisionImageDeleteMany,
    transaction,
    mockDb,
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { syncRevisionImagesForUser } from "@/lib/listings/revision-photos";

describe("revision photo lifecycle CAS LST-CAS-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      dealerId: null,
      featured: false,
      lastPhotoMutationId: null,
      lastPhotoMutationHash: null,
      lifecycleRevision: 5,
    });
    revisionFindUnique.mockResolvedValue({
      id: "revision-1",
      listingId: "listing-1",
      status: "DRAFT",
      version: 2,
      images: [
        {
          id: "image-1",
          provider: "CLOUDINARY",
          publicId: "iommarket/listings/user/image-1",
          order: 0,
          focalX: null,
          focalY: null,
        },
      ],
    });
    revisionUpdateMany.mockResolvedValue({ count: 1 });
    revisionImageUpdate.mockResolvedValue({});
    revisionImageDeleteMany.mockResolvedValue({ count: 0 });
  });

  it("rolls back photo writes when a moderation decision wins the listing CAS", async () => {
    let rolledBack = false;
    transaction.mockImplementationOnce(async (callback: (tx: typeof mockDb) => unknown) => {
      try {
        return await callback(mockDb);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });
    listingUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      syncRevisionImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        revisionId: "revision-1",
        expectedListingRevision: 5,
        photos: {
          photos: [{ imageId: "image-1" }],
          basePhotoRevision: 2,
          mutationId: "mutation-1",
        },
      }),
    ).resolves.toEqual({
      error: "Listing revision changed. Refresh and try again.",
    });

    expect(revisionImageUpdate).toHaveBeenCalled();
    expect(revisionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 2 }),
      }),
    );
    expect(rolledBack).toBe(true);
  });
});
