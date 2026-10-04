import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";

type DbClient = Prisma.TransactionClient | typeof db;

export async function discardOpenRevisions(
  client: DbClient,
  listingId: string,
  now = new Date(),
) {
  const openRevisions = await client.listingRevision.findMany({
    where: {
      listingId,
      status: { in: ["DRAFT", "PENDING"] },
    },
    include: {
      images: {
        select: { publicId: true, provider: true, imageKitFileId: true, imageKitFilePath: true },
      },
    },
  });

  if (openRevisions.length === 0) {
    return [];
  }

  const discarded = await client.listingRevision.updateMany({
    where: {
      listingId,
      status: { in: ["DRAFT", "PENDING"] },
    },
    data: {
      status: "DISCARDED",
      decidedAt: now,
      version: { increment: 1 },
    },
  });

  if (discarded.count !== openRevisions.length) {
    throw new Error("Listing revision changed. Refresh and try again.");
  }

  const liveImages = await client.listingImage.findMany({
    where: { listingId },
    select: { provider: true, publicId: true },
  });
  const liveKeys = new Set(
    liveImages.map((image) => `${image.provider}:${image.publicId}`),
  );

  for (const revision of openRevisions) {
    for (const image of revision.images) {
      const key = `${image.provider}:${image.publicId}`;
      if (liveKeys.has(key)) continue;
      const cleanup = cleanupDeliveryForRemovedImage(image);
      if (cleanup) {
        await client.listingImageCleanupJob.create({
          data: {
            publicId: cleanup.publicId,
            deliveryType: cleanup.deliveryType,
            imageKitFileId: cleanup.imageKitFileId,
            imageKitFilePath: cleanup.imageKitFilePath,
            reason: "revision-discarded",
          },
        });
      }
    }
  }

  return openRevisions.map((revision) => revision.id);
}
