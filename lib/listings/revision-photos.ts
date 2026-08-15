import type { ListingImageProvider, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
import { getListingPhotoLimit, getListingPhotoLimitError } from "@/lib/listings/photo-limits";
import {
  hashPhotoMutation,
  type ListingPhotoMutationItem,
  type SyncListingImagesInput,
  type SyncListingImagesResult,
} from "@/lib/listings/photo-mutation";

type DbClient = Prisma.TransactionClient | typeof db;

const ORDER_SHIFT = 10_000;

function imageKey(provider: ListingImageProvider, publicId: string) {
  return `${provider}:${publicId}`;
}

function normalizeFocal(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Focal points must be numbers between 0 and 1.");
  }
  return value;
}

async function enqueueCleanupIfUnreferenced(
  client: DbClient,
  input: { listingId: string; provider: ListingImageProvider; publicId: string; reason: string },
) {
  if (
    input.provider !== "CLOUDINARY" ||
    !input.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)
  ) {
    return;
  }

  const [liveCount, openRevisionCount] = await Promise.all([
    client.listingImage.count({
      where: { listingId: input.listingId, provider: input.provider, publicId: input.publicId },
    }),
    client.listingRevisionImage.count({
      where: {
        provider: input.provider,
        publicId: input.publicId,
        revision: {
          listingId: input.listingId,
          status: { in: ["DRAFT", "PENDING"] },
        },
      },
    }),
  ]);

  if (liveCount > 0 || openRevisionCount > 0) return;

  await client.listingImageCleanupJob.create({
    data: {
      publicId: input.publicId,
      deliveryType: IMAGE_CONSTRAINTS.deliveryType,
      reason: input.reason,
    },
  });
}

export async function cloneLiveImagesToRevision(
  client: DbClient,
  listingId: string,
  revisionId: string,
) {
  const images = await client.listingImage.findMany({
    where: { listingId },
    orderBy: { order: "asc" },
  });

  if (images.length === 0) return;

  await client.listingRevisionImage.createMany({
    data: images.map((image) => ({
      revisionId,
      url: image.url,
      publicId: image.publicId,
      order: image.order,
      provider: image.provider,
      assetId: image.assetId,
      version: image.version,
      width: image.width,
      height: image.height,
      format: image.format,
      bytes: image.bytes,
      uploadIntentId: null,
      focalX: image.focalX,
      focalY: image.focalY,
    })),
  });
}

export async function syncRevisionImagesForUser(input: {
  listingId: string;
  userId: string;
  revisionId: string;
  expectedListingRevision: number;
  photos: SyncListingImagesInput;
}): Promise<SyncListingImagesResult> {
  let mutationHash: string;
  try {
    mutationHash = hashPhotoMutation(input.photos.photos);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid photo mutation." };
  }

  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      userId: true,
      dealerId: true,
      featured: true,
      lastPhotoMutationId: true,
      lastPhotoMutationHash: true,
      lifecycleRevision: true,
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== input.userId) return { error: "Not authorized" };
  if (listing.lifecycleRevision !== input.expectedListingRevision) {
    return { error: "Listing revision changed. Refresh and try again." };
  }

  if (listing.lastPhotoMutationId === input.photos.mutationId) {
    if (listing.lastPhotoMutationHash === mutationHash) {
      const revision = await db.listingRevision.findUnique({
        where: { id: input.revisionId },
        select: { version: true, images: { select: { id: true } } },
      });
      return {
        data: {
          count: revision?.images.length ?? input.photos.photos.length,
          photoRevision: revision?.version ?? input.photos.basePhotoRevision,
          replayed: true,
        },
      };
    }
    return { error: "This photo change was already used with different content." };
  }

  const maxImages = getListingPhotoLimit({
    isDealer: listing.dealerId !== null,
    isFeatured: listing.featured,
  });
  if (input.photos.photos.length > maxImages) {
    return { error: getListingPhotoLimitError(maxImages) };
  }

  try {
    const nextVersion = await db.$transaction(async (tx) => {
      const revision = await tx.listingRevision.findUnique({
        where: { id: input.revisionId },
        include: { images: true },
      });
      if (!revision || revision.listingId !== input.listingId) {
        throw new Error("Revision not found");
      }
      if (revision.status !== "DRAFT") {
        throw new Error("Photos can only be changed while the revision is a draft.");
      }
      if (revision.version !== input.photos.basePhotoRevision) {
        throw new Error("These photos were updated elsewhere. Reload and try again.");
      }

      const currentById = new Map(revision.images.map((image) => [image.id, image]));
      const resolved = await Promise.all(
        input.photos.photos.map(async (photo: ListingPhotoMutationItem, index: number) => {
          const focalX = normalizeFocal(photo.focalX);
          const focalY = normalizeFocal(photo.focalY);
          if ((focalX == null) !== (focalY == null)) {
            throw new Error("Focal points must include both X and Y coordinates.");
          }
          if (photo.imageId) {
            const existing = currentById.get(photo.imageId);
            if (!existing) {
              throw new Error("An image no longer belongs to this revision.");
            }
            return { kind: "existing" as const, image: existing, order: index, focalX, focalY };
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
          return { kind: "intent" as const, intent, order: index, focalX, focalY };
        }),
      );

      const retainedIds = new Set(
        input.photos.photos.map((photo) => photo.imageId).filter((id): id is string => Boolean(id)),
      );
      const removed = revision.images.filter((image) => !retainedIds.has(image.id));

      if (revision.images.length > 0) {
        await Promise.all(
          revision.images.map((image) =>
            tx.listingRevisionImage.update({
              where: { id: image.id },
              data: { order: image.order + ORDER_SHIFT },
            }),
          ),
        );
      }

      await tx.listingRevisionImage.deleteMany({
        where: {
          revisionId: revision.id,
          ...(retainedIds.size > 0 ? { id: { notIn: [...retainedIds] } } : {}),
        },
      });

      for (const item of resolved) {
        if (item.kind === "existing") {
          await tx.listingRevisionImage.update({
            where: { id: item.image.id },
            data: { order: item.order, focalX: item.focalX, focalY: item.focalY },
          });
          continue;
        }

        const consumed = await tx.listingImageUploadIntent.updateMany({
          where: {
            id: item.intent.id,
            status: "VERIFIED",
            userId: listing.userId,
          },
          data: { status: "CONSUMED", listingId: input.listingId },
        });
        if (consumed.count !== 1) {
          throw new Error("This upload is no longer available.");
        }

        await tx.listingRevisionImage.create({
          data: {
            revisionId: revision.id,
            url: buildCanonicalListingImageUrl({
              publicId: item.intent.publicId,
              version: item.intent.version,
              format: item.intent.format,
              provider: "CLOUDINARY",
              url: "",
            }),
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

      for (const image of removed) {
        await enqueueCleanupIfUnreferenced(tx, {
          listingId: input.listingId,
          provider: image.provider,
          publicId: image.publicId,
          reason: "revision-replaced-or-removed",
        });
      }

      const bumped = await tx.listingRevision.updateMany({
        where: { id: revision.id, status: "DRAFT", version: revision.version },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) {
        throw new Error("These photos were updated elsewhere. Reload and try again.");
      }

      const listingCas = await tx.listing.updateMany({
        where: {
          id: input.listingId,
          lifecycleRevision: input.expectedListingRevision,
        },
        data: {
          lastPhotoMutationId: input.photos.mutationId,
          lastPhotoMutationHash: mutationHash,
          lifecycleRevision: { increment: 1 },
        },
      });
      if (listingCas.count !== 1) {
        throw new Error("Listing revision changed. Refresh and try again.");
      }

      return revision.version + 1;
    });

    return {
      data: {
        count: input.photos.photos.length,
        photoRevision: nextVersion,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update images" };
  }
}

export async function applyRevisionImages(
  client: DbClient,
  listingId: string,
  revisionId: string,
) {
  const [liveImages, revisionImages] = await Promise.all([
    client.listingImage.findMany({ where: { listingId } }),
    client.listingRevisionImage.findMany({
      where: { revisionId },
      orderBy: { order: "asc" },
    }),
  ]);

  const liveByKey = new Map(
    liveImages.map((image) => [imageKey(image.provider, image.publicId), image]),
  );
  const revisionKeys = new Set(
    revisionImages.map((image) => imageKey(image.provider, image.publicId)),
  );

  if (liveImages.length > 0) {
    await Promise.all(
      liveImages.map((image) =>
        client.listingImage.update({
          where: { id: image.id },
          data: { order: image.order + ORDER_SHIFT },
        }),
      ),
    );
  }

  for (const image of liveImages) {
    if (!revisionKeys.has(imageKey(image.provider, image.publicId))) {
      await client.listingImage.delete({ where: { id: image.id } });
      await enqueueCleanupIfUnreferenced(client, {
        listingId,
        provider: image.provider,
        publicId: image.publicId,
        reason: "revision-applied-removed",
      });
    }
  }

  for (const image of revisionImages) {
    const existing = liveByKey.get(imageKey(image.provider, image.publicId));
    if (existing) {
      await client.listingImage.update({
        where: { id: existing.id },
        data: {
          order: image.order,
          focalX: image.focalX,
          focalY: image.focalY,
          url: image.url,
          assetId: image.assetId,
          version: image.version,
          width: image.width,
          height: image.height,
          format: image.format,
          bytes: image.bytes,
        },
      });
      continue;
    }

    await client.listingImage.create({
      data: {
        listingId,
        url: image.url,
        publicId: image.publicId,
        order: image.order,
        provider: image.provider,
        assetId: image.assetId,
        version: image.version,
        width: image.width,
        height: image.height,
        format: image.format,
        bytes: image.bytes,
        uploadIntentId: null,
        focalX: image.focalX,
        focalY: image.focalY,
      },
    });
  }
}

export async function cleanupRejectedRevisionOnlyImages(
  client: DbClient,
  listingId: string,
  revisionId: string,
) {
  const images = await client.listingRevisionImage.findMany({
    where: { revisionId },
    select: { provider: true, publicId: true },
  });
  for (const image of images) {
    await enqueueCleanupIfUnreferenced(client, {
      listingId,
      provider: image.provider,
      publicId: image.publicId,
      reason: "revision-rejected",
    });
  }
}
