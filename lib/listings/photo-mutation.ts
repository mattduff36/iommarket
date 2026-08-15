import { createHash } from "node:crypto";
import type { ListingImageProvider, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
import { getListingPhotoLimit, getListingPhotoLimitError } from "@/lib/listings/photo-limits";
class PhotoRevisionConflictError extends Error {
  photoRevision: number;
  constructor(photoRevision: number) {
    super("These photos were updated elsewhere. Reload and try again.");
    this.photoRevision = photoRevision;
  }
}

export interface ListingPhotoMutationItem {
  imageId?: string;
  uploadIntentId?: string;
  focalX?: number | null;
  focalY?: number | null;
}

export interface SyncListingImagesInput {
  photos: ListingPhotoMutationItem[];
  basePhotoRevision: number;
  mutationId: string;
}

export type SyncListingImagesResult =
  | { data: { count: number; photoRevision: number; replayed?: boolean }; error?: undefined }
  | { data?: undefined; error: string; conflict?: boolean; photoRevision?: number };

const ORDER_SHIFT = 10_000;

export function hashPhotoMutation(photos: ListingPhotoMutationItem[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        photos.map((photo) => ({
          imageId: photo.imageId ?? null,
          uploadIntentId: photo.uploadIntentId ?? null,
          focalX: photo.focalX ?? null,
          focalY: photo.focalY ?? null,
        })),
      ),
    )
    .digest("hex");
}

function normalizeFocal(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Focal points must be numbers between 0 and 1.");
  }
  return value;
}

function normalizeFocalPair(item: ListingPhotoMutationItem) {
  const focalX = normalizeFocal(item.focalX);
  const focalY = normalizeFocal(item.focalY);
  if ((focalX == null) !== (focalY == null)) {
    throw new Error("Focal points must include both X and Y coordinates.");
  }
  return { focalX, focalY };
}

export async function syncListingImagesForUser({
  listingId,
  userId,
  isAdmin,
  input,
}: {
  listingId: string;
  userId: string;
  isAdmin: boolean;
  input: SyncListingImagesInput;
}): Promise<SyncListingImagesResult> {
  if (!input.mutationId.trim()) {
    return { error: "A photo mutation ID is required." };
  }

  let mutationHash: string;
  try {
    mutationHash = hashPhotoMutation(input.photos);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid photo mutation." };
  }

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      images: true,
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== userId) return { error: "Not authorized" };
  if (listing.status === "LIVE") {
    const { getOpenRevision, getOrCreateDraftRevision } = await import(
      "@/lib/listings/revisions"
    );
    const { syncRevisionImagesForUser } = await import("@/lib/listings/revision-photos");
    const revision =
      (await getOpenRevision(listingId)) ??
      (await getOrCreateDraftRevision({ listingId, userId }));
    if (revision.status !== "DRAFT") {
      return { error: "Photos can only be changed while the revision is a draft." };
    }
    const currentListing = await db.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { lifecycleRevision: true },
    });
    return syncRevisionImagesForUser({
      listingId,
      userId,
      revisionId: revision.id,
      expectedListingRevision: currentListing.lifecycleRevision,
      photos: input,
    });
  }
  if (
    listing.status !== "DRAFT" &&
    listing.status !== "EXPIRED" &&
    listing.status !== "TAKEN_DOWN" &&
    listing.status !== "REJECTED"
  ) {
    return { error: "Photos can only be changed while the listing is editable." };
  }

  if (listing.lastPhotoMutationId === input.mutationId) {
    if (listing.lastPhotoMutationHash === mutationHash) {
      return {
        data: {
          count: listing.images.length,
          photoRevision: listing.photoRevision,
          replayed: true,
        },
      };
    }
    return { error: "This photo change was already used with different content." };
  }

  if (listing.photoRevision !== input.basePhotoRevision) {
    return {
      error: "These photos were updated elsewhere. Reload and try again.",
      conflict: true,
      photoRevision: listing.photoRevision,
    };
  }

  const maxImages = getListingPhotoLimit({
    isDealer: listing.dealerId !== null,
    isFeatured: listing.featured,
  });
  if (input.photos.length > maxImages) {
    return { error: getListingPhotoLimitError(maxImages) };
  }

  const seen = new Set<string>();
  for (const photo of input.photos) {
    const key = photo.imageId ? `image:${photo.imageId}` : photo.uploadIntentId ? `intent:${photo.uploadIntentId}` : null;
    if (!key) return { error: "Each photo must reference an existing image or upload." };
    if (seen.has(key)) return { error: "Duplicate images are not allowed." };
    seen.add(key);
  }

  try {
    await db.$transaction(async (tx) => {
      const currentListing = await tx.listing.findUnique({
        where: { id: listingId },
        select: { photoRevision: true, status: true },
      });
      if (!currentListing) {
        throw new Error("Listing not found");
      }
      if (
        currentListing.status !== "DRAFT" &&
        currentListing.status !== "EXPIRED" &&
        currentListing.status !== "TAKEN_DOWN" &&
        currentListing.status !== "REJECTED"
      ) {
        throw new Error("Photos can only be changed while the listing is editable.");
      }
      if (currentListing.photoRevision !== input.basePhotoRevision) {
        throw new PhotoRevisionConflictError(currentListing.photoRevision);
      }

      const currentImages = await tx.listingImage.findMany({ where: { listingId } });
      const currentById = new Map(currentImages.map((image) => [image.id, image]));
      const retainedIds = new Set(
        input.photos.map((photo) => photo.imageId).filter((id): id is string => Boolean(id)),
      );
      const removedPublicIds: Array<{ publicId: string; provider: ListingImageProvider }> = [];

      for (const image of currentImages) {
        if (!retainedIds.has(image.id)) {
          removedPublicIds.push({ publicId: image.publicId, provider: image.provider });
        }
      }

      const resolved = await Promise.all(
        input.photos.map(async (photo, index) => {
          const focals = normalizeFocalPair(photo);
          if (photo.imageId) {
            const existing = currentById.get(photo.imageId);
            if (!existing) {
              throw new Error("An image no longer belongs to this listing.");
            }
            return {
              kind: "existing" as const,
              image: existing,
              order: index,
              ...focals,
            };
          }

          const intent = await tx.listingImageUploadIntent.findUnique({
            where: { id: photo.uploadIntentId },
          });
          if (!intent || intent.userId !== listing.userId) {
            throw new Error("Only your verified uploads can be attached to this listing.");
          }
          if (intent.status !== "VERIFIED") {
            throw new Error("Wait until each photo has finished uploading before saving.");
          }
          if (!intent.assetId || !intent.version || !intent.width || !intent.height || !intent.format) {
            throw new Error("A verified upload is missing authoritative image metadata.");
          }
          return {
            kind: "intent" as const,
            intent,
            order: index,
            ...focals,
          };
        }),
      );

      if (currentImages.length > 0) {
        await Promise.all(
          currentImages.map((image) =>
            tx.listingImage.update({
              where: { id: image.id },
              data: { order: image.order + ORDER_SHIFT },
            }),
          ),
        );
      }

      if (retainedIds.size === 0) {
        await tx.listingImage.deleteMany({ where: { listingId } });
      } else {
        await tx.listingImage.deleteMany({
          where: {
            listingId,
            id: { notIn: [...retainedIds] },
          },
        });
      }

      for (const item of resolved) {
        if (item.kind === "existing") {
          await tx.listingImage.update({
            where: { id: item.image.id },
            data: {
              order: item.order,
              focalX: item.focalX,
              focalY: item.focalY,
            },
          });
          continue;
        }

        const canonicalUrl = buildCanonicalListingImageUrl({
          publicId: item.intent.publicId,
          version: item.intent.version,
          format: item.intent.format,
          provider: "CLOUDINARY",
          url: "",
        });

        const consumed = await tx.listingImageUploadIntent.updateMany({
          where: {
            id: item.intent.id,
            status: "VERIFIED",
            userId: listing.userId,
          },
          data: {
            status: "CONSUMED",
            listingId,
          },
        });
        if (consumed.count !== 1) {
          throw new Error("This upload is no longer available.");
        }

        await tx.listingImage.create({
          data: {
            listingId,
            url: canonicalUrl,
            publicId: item.intent.publicId,
            order: item.order,
            provider: "CLOUDINARY",
            assetId: item.intent.assetId,
            version: item.intent.version,
            width: item.intent.width,
            height: item.intent.height,
            format: item.intent.format,
            bytes: item.intent.bytes,
            uploadIntentId: item.intent.id,
            focalX: item.focalX,
            focalY: item.focalY,
          },
        });
      }

      for (const removed of removedPublicIds) {
        if (removed.provider === "CLOUDINARY" && removed.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)) {
          await tx.listingImageCleanupJob.create({
            data: {
              publicId: removed.publicId,
              deliveryType: IMAGE_CONSTRAINTS.deliveryType,
              reason: "replaced-or-removed",
            },
          });
        }
      }

      const bumped = await tx.listing.updateMany({
        where: {
          id: listingId,
          photoRevision: input.basePhotoRevision,
          status: { in: ["DRAFT", "EXPIRED", "TAKEN_DOWN", "REJECTED"] },
        },
        data: {
          photoRevision: { increment: 1 },
          lastPhotoMutationId: input.mutationId,
          lastPhotoMutationHash: mutationHash,
        },
      });
      if (bumped.count !== 1) {
        const latest = await tx.listing.findUnique({
          where: { id: listingId },
          select: { photoRevision: true, status: true },
        });
        if (!latest) {
          throw new Error("Listing not found");
        }
        if (
          latest.status !== "DRAFT" &&
          latest.status !== "EXPIRED" &&
          latest.status !== "TAKEN_DOWN" &&
          latest.status !== "REJECTED"
        ) {
          throw new Error("Photos can only be changed while the listing is editable.");
        }
        throw new PhotoRevisionConflictError(latest.photoRevision);
      }
    });

    return {
      data: {
        count: input.photos.length,
        photoRevision: listing.photoRevision + 1,
      },
    };
  } catch (error) {
    if (error instanceof PhotoRevisionConflictError) {
      return {
        error: error.message,
        conflict: true,
        photoRevision: error.photoRevision,
      };
    }
    return { error: error instanceof Error ? error.message : "Failed to update images" };
  }
}

export type ListingImageTransaction = Prisma.TransactionClient;
