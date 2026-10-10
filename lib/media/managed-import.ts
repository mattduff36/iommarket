import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertExternalEffectAllowed } from "@/lib/database-sync/effects";
import { assertManagedUploadsConfigured } from "@/lib/media/direct-upload-token";
import { assertManagedMediaMutation, managedImportPath, managedMediaPublicId, parseManagedMediaPath, MANAGED_IMAGEKIT_DELIVERY_TYPE } from "@/lib/media/managed-policy";
import { uploadImmutableManagedImage } from "@/lib/media/managed-io";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";

export const MANAGED_IMPORT_ABANDONED_REASON = "managed-import-abandoned";
export const MANAGED_IMPORT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ManagedImportIdentity {
  provider: "IMAGEKIT";
  publicId: string;
  imageKitFileId: string;
  imageKitFilePath: string;
  cleanupReceiptId: string;
}

/** Serialize each import path with attachment and cleanup, not a whole table. */
export async function lockManagedImportIdentity(tx: Pick<Prisma.TransactionClient, "$queryRaw">, filePath: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${filePath}, 0))::text AS lock_result`;
}

/** A durable receipt precedes the provider write, including an upload with a lost response. */
export async function uploadManagedImport(input: { publicId: string; bytes: Buffer; contentType: string; order: number }) {
  const scope = assertManagedUploadsConfigured();
  await assertExternalEffectAllowed({ mediaIds: [input.publicId] });
  const format = input.contentType.replace("image/", "").replace("jpeg", "jpg");
  const cleaned = await stripListingImageMetadata({ bytes: input.bytes, format });
  if (cleaned.format !== "jpg" && cleaned.format !== "png" && cleaned.format !== "webp") throw new Error("Unsupported import output.");
  const filePath = managedImportPath(scope, input.publicId, cleaned.format);
  const receipt = await db.$transaction(async (tx) => {
    await lockManagedImportIdentity(tx, filePath);
    const previous = await tx.listingImageCleanupJob.findFirst({
      where: { imageKitFilePath: filePath, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE, reason: MANAGED_IMPORT_ABANDONED_REASON }, select: { id: true },
    });
    if (previous) throw new Error("This import path was already used. Start a fresh import attempt.");
    return tx.listingImageCleanupJob.create({ data: {
      publicId: input.publicId, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
      imageKitFilePath: filePath, reason: MANAGED_IMPORT_ABANDONED_REASON,
    } });
  });
  const stored = await uploadImmutableManagedImage({ filePath, bytes: cleaned.bytes });
  const recorded = await db.listingImageCleanupJob.updateMany({
    where: { id: receipt.id, status: "PENDING", attempts: 0, lastError: null, imageKitFileId: null },
    data: { imageKitFileId: stored.fileId },
  });
  if (recorded.count !== 1) throw new Error("Import receipt changed before the upload could be attached.");
  return {
    provider: "IMAGEKIT" as const, publicId: input.publicId, url: `imagekit-private:${filePath}`,
    assetId: stored.fileId, version: "1", width: cleaned.width, height: cleaned.height,
    format: cleaned.format, bytes: cleaned.bytesLength, order: input.order, ownership: null,
    imageKitFileId: stored.fileId, imageKitFilePath: filePath, cleanupReceiptId: receipt.id,
  };
}

/** Must run in the same transaction that attaches the image. A cleanup claim wins over attachment. */
export async function claimManagedImportsForAttachment(tx: Pick<Prisma.TransactionClient, "listingImageCleanupJob" | "$queryRaw">, images: Array<{
  provider: string; publicId: string; imageKitFileId?: string | null; imageKitFilePath?: string | null; cleanupReceiptId?: string;
}>) {
  for (const image of images) {
    if (image.provider !== "IMAGEKIT") continue;
    const parsed = image.imageKitFilePath ? parseManagedMediaPath(image.imageKitFilePath) : null;
    if (!image.cleanupReceiptId || !image.imageKitFileId || !image.imageKitFilePath || parsed?.kind !== "imports" ||
      managedMediaPublicId(image.imageKitFilePath) !== image.publicId) throw new Error("Import attachment has no complete ownership receipt.");
    assertManagedMediaMutation(image.imageKitFilePath);
    await lockManagedImportIdentity(tx, image.imageKitFilePath);
    const claimed = await tx.listingImageCleanupJob.updateMany({
      where: { id: image.cleanupReceiptId, publicId: image.publicId, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
        imageKitFileId: image.imageKitFileId, imageKitFilePath: image.imageKitFilePath,
        reason: MANAGED_IMPORT_ABANDONED_REASON, status: "PENDING", attempts: 0, lastError: null },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("This import was already attached or claimed for cleanup. Run a fresh import.");
  }
}
