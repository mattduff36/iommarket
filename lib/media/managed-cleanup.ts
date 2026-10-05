import { lockManagedImportIdentity, MANAGED_IMPORT_ABANDONED_REASON } from "@/lib/media/managed-import";
import { db } from "@/lib/db";
import { assertExternalEffectAllowed } from "@/lib/database-sync/effects";
import { assertManagedMediaMutation, managedMediaPublicId, MANAGED_IMAGEKIT_DELIVERY_TYPE } from "@/lib/media/managed-policy";
import { deleteManagedImageKitFile, findManagedFileByPath } from "@/lib/media/managed-io";

export const MANAGED_ABANDONED_REASON = "managed-upload-abandoned";
export const MANAGED_ABANDONED_DELAY_MS = 65 * 60 * 1000;
export interface ManagedCleanupReceipt {
  id: string;
  publicId: string;
  imageKitFileId: string | null;
  imageKitFilePath: string | null;
}

export async function processManagedCleanupReceipt(job: ManagedCleanupReceipt, now = new Date()) {
  if (!job.imageKitFilePath) throw new Error("Managed cleanup requires a recorded path.");
  const filePath = job.imageKitFilePath;
  const identity = assertManagedMediaMutation(filePath);
  if (managedMediaPublicId(filePath) !== job.publicId) throw new Error("Managed cleanup ownership does not match the recorded path.");
  await assertExternalEffectAllowed({ mediaIds: [job.publicId, filePath, ...(job.imageKitFileId ? [job.imageKitFileId] : [])] });

  const eligibility = await db.$transaction(async (tx) => {
    // Serializes with verification/consumption's row update. Expire before deleting
    // so a verified upload cannot be attached after the reference check.
    if (identity.kind === "imports") await lockManagedImportIdentity(tx, filePath);
    if (identity.kind !== "imports") await tx.$queryRaw`SELECT id FROM public."ListingImageUploadIntent" WHERE id = ${identity.intentId} FOR UPDATE`;
    const intent = identity.kind === "imports" ? null : await tx.listingImageUploadIntent.findUnique({ where: { id: identity.intentId } });
    if (intent && (intent.userId !== identity.userId || intent.publicId !== job.publicId ||
      intent.deliveryType !== MANAGED_IMAGEKIT_DELIVERY_TYPE)) throw new Error("Managed cleanup owner changed.");
    if (intent && (intent.status === "ISSUED" || intent.status === "VERIFIED")) {
      const rawAlreadyVerified = identity.kind === "quarantine" && intent.status === "VERIFIED" && intent.imageKitFilePath !== filePath;
      if (!rawAlreadyVerified) {
        if (intent.expiresAt.getTime() > now.getTime()) return "deferred" as const;
        const expired = await tx.listingImageUploadIntent.updateMany({
          where: { id: intent.id, userId: identity.userId, status: intent.status, expiresAt: { lte: now },
            image: { is: null }, revisionImage: { is: null } },
          data: { status: "EXPIRED" },
        });
        if (expired.count !== 1) return "deferred" as const;
      }
    }
    const referenceWhere = { OR: [
      { imageKitFilePath: filePath }, ...(job.imageKitFileId ? [{ imageKitFileId: job.imageKitFileId }] : []),
    ] };
    const [live, revision] = await Promise.all([
      tx.listingImage.findFirst({ where: referenceWhere, select: { id: true } }),
      tx.listingRevisionImage.findFirst({ where: { ...referenceWhere, revision: { status: { in: ["DRAFT", "PENDING"] } } }, select: { id: true } }),
    ]);
    if (live || revision) return "referenced" as const;
    if (identity.kind === "imports") {
      // Close the original receipt before releasing the lock. A delayed attachment must fail.
      await tx.listingImageCleanupJob.updateMany({
        where: { imageKitFilePath: filePath, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
          reason: MANAGED_IMPORT_ABANDONED_REASON, status: "PENDING", attempts: 0, lastError: null },
        data: { status: "COMPLETED", completedAt: now, lastError: "IMPORT_ATTACHMENT_CLOSED" },
      });
    }
    return "eligible" as const;
  });
  if (eligibility !== "eligible") return { status: eligibility };

  let fileId = job.imageKitFileId;
  if (!fileId) {
    const recovered = await findManagedFileByPath({ filePath });
    if (!recovered) return { status: "missing" as const };
    if (recovered.filePath !== filePath) throw new Error("Recovered cleanup file path does not match its receipt.");
    fileId = recovered.fileId;
    const recorded = await db.listingImageCleanupJob.updateMany({
      where: { id: job.id, imageKitFileId: null, imageKitFilePath: filePath }, data: { imageKitFileId: fileId },
    });
    if (recorded.count !== 1) throw new Error("The cleanup receipt changed during identity recovery.");
  }
  await deleteManagedImageKitFile({ fileId, filePath, allowlist: [{ fileId, filePath }] });
  return { status: "deleted" as const };
}
