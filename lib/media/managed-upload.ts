import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { assertManagedUploadsConfigured, createImageKitUploadToken } from "@/lib/media/direct-upload-token";
import { managedInputFormat, managedUploadPaths, MANAGED_IMAGEKIT_DELIVERY_TYPE } from "@/lib/media/managed-policy";
import { downloadManagedImageKitBytes, requireManagedFileDetails, uploadImmutableManagedImage } from "@/lib/media/managed-io";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";

const INTENT_TTL_MS = 60 * 60 * 1000;
export const MANAGED_ABANDONED_REASON = "managed-upload-abandoned";
export const MANAGED_ABANDONED_DELAY_MS = INTENT_TTL_MS + 5 * 60 * 1000;
export interface ManagedUploadInput { fileName: string; fileSize: number; fileType: string }

export async function issueManagedImageKitUploadIntent(userId: string, input: ManagedUploadInput) {
  const scope = assertManagedUploadsConfigured();
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    throw new Error("Images must be non-empty and 10MB or smaller.");
  }
  const format = managedInputFormat(input.fileName.split(".").pop() ?? "");
  const expectedMime = format === "jpg" ? "image/jpeg" : `image/${format}`;
  const allowedMimes = format === "heic" || format === "heif"
    ? ["image/heic", "image/heif"]
    : [expectedMime];
  if (input.fileType && !allowedMimes.includes(input.fileType)) throw new Error("The image filename and type do not agree.");
  const id = randomUUID();
  const paths = managedUploadPaths(scope, userId, id, format);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  // Durable path receipts exist before external uploads, including a lost client response.
  const intent = await db.$transaction(async (tx) => {
    const created = await tx.listingImageUploadIntent.create({ data: {
      id, userId, publicId: paths.publicId, folder: paths.quarantineFolder,
      imageKitFilePath: paths.quarantinePath, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
      format, bytes: input.fileSize, expiresAt,
    } });
    await tx.listingImageCleanupJob.createMany({ data: [paths.quarantinePath, paths.finalPath].map((filePath) => ({
      publicId: paths.publicId, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
      imageKitFilePath: filePath, reason: MANAGED_ABANDONED_REASON,
    })) });
    return created;
  });
  return { intent, upload: createImageKitUploadToken({ userId, intentId: id, format }) };
}

function hasHeifSignature(bytes: Buffer) {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  return !brands.some((brand) => brand === "avif" || brand === "avis") &&
    brands.some((brand) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand));
}

export async function finalizeManagedImageKitUpload(input: { userId: string; intentId: string; fileId: string }) {
  const scope = assertManagedUploadsConfigured();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.fileId)) throw new Error("Upload identity is invalid.");
  const intent = await db.listingImageUploadIntent.findUnique({ where: { id: input.intentId } });
  if (!intent || intent.userId !== input.userId || intent.deliveryType !== MANAGED_IMAGEKIT_DELIVERY_TYPE) {
    throw new Error("Upload not found.");
  }
  const sourceVersion = `source:${input.fileId}`;
  if (intent.status === "VERIFIED" || intent.status === "CONSUMED") {
    if (intent.version !== sourceVersion || !intent.imageKitFileId || !intent.imageKitFilePath ||
      (intent.status === "VERIFIED" && intent.expiresAt.getTime() <= Date.now())) {
      throw new Error("This upload expired or belongs to a different file.");
    }
    return intent;
  }
  if (intent.status !== "ISSUED" || intent.expiresAt.getTime() <= Date.now()) throw new Error("This upload expired. Please try again.");
  const format = managedInputFormat(intent.format ?? "");
  const paths = managedUploadPaths(scope, input.userId, intent.id, format);
  if (intent.publicId !== paths.publicId || intent.folder !== paths.quarantineFolder ||
    intent.imageKitFilePath !== paths.quarantinePath || (intent.imageKitFileId && intent.imageKitFileId !== input.fileId)) {
    throw new Error("Upload intent identity changed.");
  }
  const observed = await requireManagedFileDetails({ fileId: input.fileId, filePath: paths.quarantinePath });
  if (observed.size !== intent.bytes) throw new Error("The uploaded file size does not match this request.");
  const registered = await db.listingImageUploadIntent.updateMany({
    where: { id: intent.id, userId: input.userId, status: "ISSUED", expiresAt: { gt: new Date() },
      imageKitFilePath: paths.quarantinePath, OR: [{ imageKitFileId: null }, { imageKitFileId: input.fileId }] },
    data: { imageKitFileId: input.fileId },
  });
  if (registered.count !== 1) throw new Error("Upload is no longer available. Retry verification.");

  const original = await downloadManagedImageKitBytes({ filePath: paths.quarantinePath });
  if (original.length !== observed.size) throw new Error("The uploaded file contents changed.");
  const isHeif = format === "heic" || format === "heif";
  if (isHeif && !hasHeifSignature(original)) throw new Error("The uploaded file is not a HEIC/HEIF image.");
  const processBytes = isHeif
    ? await downloadManagedImageKitBytes({ filePath: paths.quarantinePath, convertHeif: true })
    : original;
  const cleaned = await stripListingImageMetadata({ bytes: processBytes, format: paths.outputFormat });
  if ([cleaned.width, cleaned.height].sort((a, b) => a - b).join("x") !==
    [observed.width, observed.height].sort((a, b) => a - b).join("x")) {
    throw new Error("Processed image dimensions do not agree with the uploaded original.");
  }
  const stored = await uploadImmutableManagedImage({ filePath: paths.finalPath, bytes: cleaned.bytes });
  const data = {
    status: "VERIFIED" as const, assetId: stored.fileId, version: sourceVersion,
    imageKitFileId: stored.fileId, imageKitFilePath: paths.finalPath,
    width: cleaned.width, height: cleaned.height, format: cleaned.format, bytes: cleaned.bytesLength,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  };
  return db.$transaction(async (tx) => {
    const updated = await tx.listingImageUploadIntent.updateMany({
      where: { id: intent.id, userId: input.userId, status: "ISSUED", expiresAt: { gt: new Date() },
        imageKitFileId: input.fileId, imageKitFilePath: paths.quarantinePath },
      data,
    });
    if (updated.count === 1) {
      await tx.listingImageCleanupJob.create({ data: {
        publicId: paths.publicId, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
        imageKitFileId: input.fileId, imageKitFilePath: paths.quarantinePath, reason: "managed-verified-quarantine",
      } });
      return { ...intent, ...data };
    }
    const latest = await tx.listingImageUploadIntent.findUnique({ where: { id: intent.id } });
    if (latest?.userId === input.userId && latest.version === sourceVersion &&
      latest.imageKitFileId === stored.fileId && latest.imageKitFilePath === paths.finalPath &&
      (latest.status === "VERIFIED" || latest.status === "CONSUMED")) return latest;
    // The pre-created path receipt reclaims the immutable output after an expired/lost race.
    throw new Error("Upload state changed before verification completed.");
  });
}
