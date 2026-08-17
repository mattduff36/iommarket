import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listingFindUnique,
  listingUpdate,
  listingImageFindMany,
  listingImageUpdate,
  listingImageCreate,
  listingImageDeleteMany,
  intentFindUnique,
  intentUpdateMany,
  cleanupCreate,
  transaction,
} = vi.hoisted(() => ({
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  listingImageFindMany: vi.fn(),
  listingImageUpdate: vi.fn(),
  listingImageCreate: vi.fn(),
  listingImageDeleteMany: vi.fn(),
  intentFindUnique: vi.fn(),
  intentUpdateMany: vi.fn(),
  cleanupCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findUnique: listingFindUnique,
      update: listingUpdate,
    },
    listingImage: {
      findMany: listingImageFindMany,
      update: listingImageUpdate,
      create: listingImageCreate,
      deleteMany: listingImageDeleteMany,
    },
    listingImageUploadIntent: {
      findUnique: intentFindUnique,
      updateMany: intentUpdateMany,
    },
    listingImageCleanupJob: {
      create: cleanupCreate,
    },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/images/cloudinary-url", () => ({
  buildCanonicalListingImageUrl: () =>
    "https://res.cloudinary.com/demo/image/private/v1/iommarket/listings/staging/user/new",
}));

import { hashPhotoMutation, syncListingImagesForUser } from "@/lib/listings/photo-mutation";

const existingImage = {
  id: "img-1",
  listingId: "listing-1",
  url: "https://res.cloudinary.com/demo/image/private/v1/iommarket/listings/one",
  publicId: "iommarket/listings/one",
  order: 0,
  provider: "CLOUDINARY",
  assetId: "asset-1",
  version: "1",
  width: 1600,
  height: 1000,
  format: "jpg",
  bytes: 1000,
  uploadIntentId: "intent-old",
  focalX: 0.4,
  focalY: 0.5,
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "listing-1",
    userId: "user-1",
    dealerId: null,
    featured: false,
    status: "DRAFT",
    photoRevision: 3,
    lastPhotoMutationId: "mut-prev",
    lastPhotoMutationHash: "hash-prev",
    images: [existingImage],
    ...overrides,
  };
}

describe("listing photo mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingImageFindMany.mockResolvedValue([existingImage]);
    listingImageUpdate.mockResolvedValue(existingImage);
    listingImageCreate.mockResolvedValue({ id: "img-2" });
    listingImageDeleteMany.mockResolvedValue({ count: 0 });
    listingUpdate.mockResolvedValue({ count: 1 });
    intentUpdateMany.mockResolvedValue({ count: 1 });
    cleanupCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        listingImage: {
          findMany: listingImageFindMany,
          update: listingImageUpdate,
          create: listingImageCreate,
          deleteMany: listingImageDeleteMany,
        },
        listingImageUploadIntent: {
          findUnique: intentFindUnique,
          updateMany: intentUpdateMany,
        },
        listingImageCleanupJob: {
          create: cleanupCreate,
        },
        listing: {
          findUnique: listingFindUnique,
          update: listingUpdate,
          updateMany: listingUpdate,
        },
      }),
    );
  });

  it("PHOTO-ORDER-REPLAY-001 replays identical mutations and rejects reused IDs", async () => {
    listingFindUnique.mockResolvedValue(
      listing({
        lastPhotoMutationId: "mut-1",
        lastPhotoMutationHash: hashPhotoMutation([{ imageId: "img-1" }]),
      }),
    );

    const replay = await syncListingImagesForUser({
      listingId: "listing-1",
      userId: "user-1",
      isAdmin: false,
      input: {
        photos: [{ imageId: "img-1" }],
        basePhotoRevision: 3,
        mutationId: "mut-1",
      },
    });

    expect(replay).toMatchObject({ data: { replayed: true } });
    expect(transaction).not.toHaveBeenCalled();

    listingFindUnique.mockResolvedValue(
      listing({
        lastPhotoMutationId: "mut-1",
        lastPhotoMutationHash: "different",
      }),
    );

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ imageId: "img-1", focalX: 0.2, focalY: 0.3 }],
          basePhotoRevision: 3,
          mutationId: "mut-1",
        },
      }),
    ).resolves.toEqual({
      error: "This photo change was already used with different content.",
    });
  });

  it("PHOTO-ORDER-CONCURRENCY-001 rejects stale revisions", async () => {
    listingFindUnique.mockResolvedValue(listing({ photoRevision: 4 }));
    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ imageId: "img-1" }],
          basePhotoRevision: 3,
          mutationId: "mut-new",
        },
      }),
    ).resolves.toMatchObject({
      conflict: true,
      photoRevision: 4,
    });
  });

  it("PHOTO-ORDER-IDENTITY-001 PHOTO-ORDER-PERSIST-001 PHOTO-ORDER-QUERY-001 keep existing rows and consume verified intents", async () => {
    listingFindUnique.mockResolvedValue(listing());
    intentFindUnique.mockResolvedValue({
      id: "intent-2",
      userId: "user-1",
      status: "VERIFIED",
      publicId: "iommarket/listings/staging/user/new",
      assetId: "asset-2",
      version: "2",
      width: 1200,
      height: 1800,
      format: "jpg",
      bytes: 2000,
    });

    const result = await syncListingImagesForUser({
      listingId: "listing-1",
      userId: "user-1",
      isAdmin: false,
      input: {
        photos: [
          { uploadIntentId: "intent-2", focalX: 0.2, focalY: 0.8 },
          { imageId: "img-1", focalX: 0.4, focalY: 0.5 },
        ],
        basePhotoRevision: 3,
        mutationId: "mut-2",
      },
    });

    expect(result).toEqual({ data: { count: 2, photoRevision: 4 } });
    expect(listingImageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          uploadIntentId: "intent-2",
          order: 0,
          width: 1200,
          height: 1800,
          focalX: 0.2,
          focalY: 0.8,
        }),
      }),
    );
    expect(listingImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order: 1,
          focalX: 0.4,
          focalY: 0.5,
        }),
      }),
    );
    expect(intentUpdateMany).toHaveBeenCalledWith({
      where: { id: "intent-2", status: "VERIFIED", userId: "user-1" },
      data: { status: "CONSUMED", listingId: "listing-1" },
    });
  });

  it.each([
    {
      photos: [{ imageId: "img-1", focalX: 1.1, focalY: 0.5 }],
      error: "Focal points must be numbers between 0 and 1.",
    },
    {
      photos: [{ imageId: "img-1", focalX: 0.5, focalY: null }],
      error: "Focal points must include both X and Y coordinates.",
    },
  ])("PHOTO-FOCAL-VALIDATION-001 rejects invalid focal coordinates", async ({ photos, error }) => {
    listingFindUnique.mockResolvedValue(listing());

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos,
          basePhotoRevision: 3,
          mutationId: "mut-invalid-focal",
        },
      }),
    ).resolves.toEqual({ error });
  });

  it("PHOTO-ORDER-CONCURRENCY-001 reports the winning revision when commit-time CAS loses", async () => {
    listingFindUnique
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing({ photoRevision: 7 }));
    listingUpdate.mockResolvedValue({ count: 0 });

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ imageId: "img-1" }],
          basePhotoRevision: 3,
          mutationId: "mut-cas",
        },
      }),
    ).resolves.toMatchObject({
      conflict: true,
      photoRevision: 7,
    });
  });

  it("rejects photo changes when the listing leaves draft inside the write transaction", async () => {
    listingFindUnique
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing({ status: "LIVE", photoRevision: 3 }));
    listingUpdate.mockResolvedValue({ count: 0 });

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ imageId: "img-1" }],
          basePhotoRevision: 3,
          mutationId: "mut-live",
        },
      }),
    ).resolves.toEqual({
      error: "Photos can only be changed while the listing is editable.",
    });
  });

  it("does not attach an intent that was expired before consume committed", async () => {
    listingFindUnique.mockResolvedValue(listing());
    intentFindUnique.mockResolvedValue({
      id: "intent-2",
      userId: "user-1",
      status: "VERIFIED",
      publicId: "iommarket/listings/staging/user/new",
      assetId: "asset-2",
      version: "2",
      width: 1200,
      height: 1800,
      format: "jpg",
      bytes: 2000,
    });
    intentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ uploadIntentId: "intent-2" }],
          basePhotoRevision: 3,
          mutationId: "mut-expired",
        },
      }),
    ).resolves.toEqual({
      error: "This upload is no longer available.",
    });
    expect(listingImageCreate).not.toHaveBeenCalled();
  });

  it("PHOTO-TRUST-001 rejects foreign or unverified uploads", async () => {
    listingFindUnique.mockResolvedValue(listing());
    intentFindUnique.mockResolvedValue({
      id: "intent-2",
      userId: "other-user",
      status: "VERIFIED",
    });

    await expect(
      syncListingImagesForUser({
        listingId: "listing-1",
        userId: "user-1",
        isAdmin: false,
        input: {
          photos: [{ uploadIntentId: "intent-2" }],
          basePhotoRevision: 3,
          mutationId: "mut-3",
        },
      }),
    ).resolves.toEqual({
      error: "Only your verified uploads can be attached to this listing.",
    });
  });
});
