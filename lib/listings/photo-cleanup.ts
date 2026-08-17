import { db } from "@/lib/db";
import { deleteImage } from "@/lib/upload/cloudinary";

export async function enqueueListingImageCleanup({
  publicId,
  deliveryType = "private",
  reason,
}: {
  publicId: string;
  deliveryType?: string;
  reason: string;
}) {
  await db.listingImageCleanupJob.create({
    data: {
      publicId,
      deliveryType,
      reason,
    },
  });
}

const CLEANUP_CLAIM_WHERE = {
  OR: [
    { status: "PENDING" as const },
    { status: "FAILED" as const, attempts: { lt: 5 } },
  ],
};

export async function processListingImageCleanupJobs(limit = 20) {
  const jobs = await db.listingImageCleanupJob.findMany({
    where: CLEANUP_CLAIM_WHERE,
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const job of jobs) {
    const claimed = await db.listingImageCleanupJob.updateMany({
      where: {
        id: job.id,
        ...CLEANUP_CLAIM_WHERE,
      },
      data: {
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      continue;
    }
    processed += 1;

    try {
      await deleteImage(job.publicId, job.deliveryType);
      await db.listingImageCleanupJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
      const alreadyGone = /not found/i.test(message);
      await db.listingImageCleanupJob.update({
        where: { id: job.id },
        data: {
          status: alreadyGone ? "COMPLETED" : "FAILED",
          completedAt: alreadyGone ? new Date() : null,
          lastError: alreadyGone ? null : message,
        },
      });
    }
  }

  return { processed };
}

export const EXPIRE_ABANDONED_INTENT_BATCH_SIZE = 50;

export async function expireAbandonedListingImageIntents(
  now = new Date(),
  limit = EXPIRE_ABANDONED_INTENT_BATCH_SIZE,
) {
  const expired = await db.listingImageUploadIntent.findMany({
    where: {
      status: { in: ["ISSUED", "VERIFIED"] },
      expiresAt: { lte: now },
      image: { is: null },
    },
    select: { id: true, publicId: true, deliveryType: true },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });

  let expiredCount = 0;
  for (const intent of expired) {
    const claimed = await db.$transaction(async (tx) => {
      const updated = await tx.listingImageUploadIntent.updateMany({
        where: {
          id: intent.id,
          status: { in: ["ISSUED", "VERIFIED"] },
          expiresAt: { lte: now },
          image: { is: null },
        },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) {
        return false;
      }
      await tx.listingImageCleanupJob.create({
        data: {
          publicId: intent.publicId,
          deliveryType: intent.deliveryType,
          reason: "expired-intent",
        },
      });
      return true;
    });
    if (claimed) {
      expiredCount += 1;
    }
  }

  return { expired: expiredCount };
}
