import { db } from "@/lib/db";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
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

const CLEANUP_PROCESSING_MARKER = "__PROCESSING_LISTING_IMAGE_CLEANUP__";
const CLEANUP_CLAIM_TTL_MS = 5 * 60 * 1000;
const CLEANUP_PUBLIC_ID_PREFIXES = [
  `${IMAGE_CONSTRAINTS.folder}/staging/`,
  `${IMAGE_CONSTRAINTS.folder}/import/`,
  `${IMAGE_CONSTRAINTS.folder}/repair/`,
  `${IMAGE_CONSTRAINTS.folder}/preview-packs/`,
  `${IMAGE_CONSTRAINTS.folder}/founding/`,
] as const;

function cleanupClaimWhere(now: Date) {
  return {
    status: { in: ["PENDING" as const, "FAILED" as const] },
    attempts: { lt: 5 },
    OR: [
      { lastError: null },
      { lastError: { not: CLEANUP_PROCESSING_MARKER } },
      {
        lastError: CLEANUP_PROCESSING_MARKER,
        updatedAt: { lt: new Date(now.getTime() - CLEANUP_CLAIM_TTL_MS) },
      },
    ],
  };
}

function assertSafeCleanupTarget(job: { publicId: string; deliveryType: string }) {
  if (
    job.deliveryType !== IMAGE_CONSTRAINTS.deliveryType ||
    !CLEANUP_PUBLIC_ID_PREFIXES.some((prefix) => job.publicId.startsWith(prefix))
  ) {
    throw new Error(`Refusing unsafe listing image cleanup target: ${job.publicId}`);
  }
}

async function cleanupTargetIsReferenced(publicId: string) {
  const [live, openRevision] = await Promise.all([
    db.listingImage.findFirst({
      where: { publicId },
      select: { id: true },
    }),
    db.listingRevisionImage.findFirst({
      where: {
        publicId,
        revision: { status: { in: ["DRAFT", "PENDING"] } },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(live || openRevision);
}

export async function processListingImageCleanupJobs(limit = 20) {
  const now = new Date();
  const jobs = await db.listingImageCleanupJob.findMany({
    where: cleanupClaimWhere(now),
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const job of jobs) {
    const claimed = await db.listingImageCleanupJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
      },
      data: {
        attempts: { increment: 1 },
        lastError: CLEANUP_PROCESSING_MARKER,
      },
    });
    if (claimed.count !== 1) {
      continue;
    }
    processed += 1;

    try {
      assertSafeCleanupTarget(job);
      if (await cleanupTargetIsReferenced(job.publicId)) {
        await db.listingImageCleanupJob.updateMany({
          where: {
            id: job.id,
            attempts: job.attempts + 1,
            lastError: CLEANUP_PROCESSING_MARKER,
          },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            lastError: null,
          },
        });
        continue;
      }
      await deleteImage(job.publicId, job.deliveryType);
      await db.listingImageCleanupJob.updateMany({
        where: {
          id: job.id,
          attempts: job.attempts + 1,
          lastError: CLEANUP_PROCESSING_MARKER,
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
      const alreadyGone = /not found/i.test(message);
      await db.listingImageCleanupJob.updateMany({
        where: {
          id: job.id,
          attempts: job.attempts + 1,
          lastError: CLEANUP_PROCESSING_MARKER,
        },
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
