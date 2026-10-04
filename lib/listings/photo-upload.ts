import { IMAGE_CONSTRAINTS, isAllowedListingImageFormat, validateListingImageBounds } from "@/lib/images/constraints";
import { isTrustedListingPublicId } from "@/lib/images/cloudinary-url";
import { db } from "@/lib/db";
import { imageKitDevUploadsEnabled } from "@/lib/media/config";
import { disposableFolderForUser } from "@/lib/media/disposable-media";
import { imageKitDevPublicId } from "@/lib/media/delete-guard";
import {
  createSignedListingUpload,
  getCloudinaryResource,
} from "@/lib/upload/cloudinary";

const INTENT_TTL_MS = 60 * 60 * 1000;

export function createListingUploadPublicId(userId: string, intentId: string) {
  return `${IMAGE_CONSTRAINTS.folder}/staging/${userId}/${intentId}`;
}

export async function issueListingImageUploadIntent(userId: string) {
  if (imageKitDevUploadsEnabled()) return issueImageKitListingUploadIntent(userId);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const intent = await db.listingImageUploadIntent.create({
    data: {
      userId,
      publicId: `${IMAGE_CONSTRAINTS.folder}/staging/${userId}/pending-${crypto.randomUUID()}`,
      folder: IMAGE_CONSTRAINTS.folder,
      expiresAt,
    },
  });

  const publicId = createListingUploadPublicId(userId, intent.id);
  const updated = await db.listingImageUploadIntent.update({
    where: { id: intent.id },
    data: { publicId },
  });

  return {
    intent: updated,
    upload: createSignedListingUpload({ publicId }),
  };
}

async function issueImageKitListingUploadIntent(userId: string) {
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const intent = await db.listingImageUploadIntent.create({
    data: {
      userId,
      publicId: `imagekit-dev/pending-${crypto.randomUUID()}`,
      folder: "/iommarket-dev-disposable/pending",
      deliveryType: "imagekit",
      expiresAt,
    },
  });
  const folder = disposableFolderForUser(userId, intent.id);
  const updated = await db.listingImageUploadIntent.update({
    where: { id: intent.id },
    data: { publicId: `imagekit-dev/pending-${intent.id}`, folder },
  });
  return {
    intent: updated,
    upload: {
      provider: "imagekit" as const,
      uploadUrl: "/api/listing-images/imagekit-upload",
    },
  };
}

export async function verifyImageKitListingUpload(input: {
  userId: string;
  intentId: string;
  fileId: string;
  filePath: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}) {
  const intent = await db.listingImageUploadIntent.findUnique({ where: { id: input.intentId } });
  if (!intent || intent.userId !== input.userId || intent.deliveryType !== "imagekit") {
    return { error: "Upload not found." };
  }
  if (intent.status === "VERIFIED") return { data: intent };
  if (intent.status !== "ISSUED") return { error: "This upload can no longer be verified." };
  if (!input.filePath.startsWith(`${intent.folder}/`) && input.filePath !== intent.folder) {
    return { error: "The uploaded file does not match this request." };
  }
  const verifiedData = {
    status: "VERIFIED" as const,
    publicId: imageKitDevPublicId(input.fileId),
    assetId: input.fileId,
    folder: input.filePath,
    version: "1",
    width: input.width,
    height: input.height,
    format: input.format,
    bytes: input.bytes,
    deliveryType: "imagekit",
    imageKitFileId: input.fileId,
    imageKitFilePath: input.filePath,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  };
  const verified = await db.listingImageUploadIntent.updateMany({
    where: { id: intent.id, status: "ISSUED", userId: input.userId },
    data: verifiedData,
  });
  if (verified.count !== 1) return { error: "This upload can no longer be verified." };
  return { data: { ...intent, ...verifiedData } };
}

export async function finalizeListingImageUploadIntent({
  userId,
  intentId,
  publicId,
  assetId,
  version,
}: {
  userId: string;
  intentId: string;
  publicId: string;
  assetId?: string;
  version?: string;
}) {
  const intent = await db.listingImageUploadIntent.findUnique({
    where: { id: intentId },
  });
  if (!intent || intent.userId !== userId) {
    return { error: "Upload not found." };
  }
  if (intent.deliveryType === "imagekit") {
    return { error: "This upload must be verified by the ImageKit development uploader." };
  }
  if (intent.status === "VERIFIED") {
    return { data: intent };
  }
  if (intent.status !== "ISSUED") {
    return { error: "This upload can no longer be verified." };
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    await expireIssuedIntent(intent.id, intent.publicId);
    return { error: "This upload expired. Please try again." };
  }
  if (intent.publicId !== publicId || !isTrustedListingPublicId(publicId)) {
    return { error: "The uploaded file does not match this request." };
  }

  let resource;
  try {
    resource = await getCloudinaryResource({
      publicId,
      deliveryType: IMAGE_CONSTRAINTS.deliveryType,
    });
  } catch {
    return { error: "Could not verify the uploaded image." };
  }

  if (assetId && resource.assetId !== assetId) {
    await rejectIntent(intent.id, publicId, "asset-mismatch");
    return { error: "The uploaded file does not match this request." };
  }
  if (version && resource.version !== String(version)) {
    await rejectIntent(intent.id, publicId, "version-mismatch");
    return { error: "The uploaded file does not match this request." };
  }
  if (resource.publicId !== publicId) {
    await rejectIntent(intent.id, publicId, "public-id-mismatch");
    return { error: "The uploaded file does not match this request." };
  }
  if (resource.resourceType !== "image" || resource.type !== IMAGE_CONSTRAINTS.deliveryType) {
    await rejectIntent(intent.id, publicId, "invalid-resource");
    return { error: "Only private listing images can be saved." };
  }
  if (!isAllowedListingImageFormat(resource.format)) {
    await rejectIntent(intent.id, publicId, "invalid-format");
    return { error: "Images must be JPG, PNG, WebP, HEIC, or HEIF." };
  }

  const boundsError = validateListingImageBounds({
    width: resource.width,
    height: resource.height,
    bytes: resource.bytes,
  });
  if (boundsError) {
    await rejectIntent(intent.id, publicId, "invalid-bounds");
    return { error: boundsError };
  }

  const verifiedData = {
    status: "VERIFIED" as const,
    assetId: resource.assetId,
    version: resource.version,
    width: resource.width,
    height: resource.height,
    format: resource.format,
    bytes: resource.bytes,
    deliveryType: resource.type,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  };
  const verified = await db.listingImageUploadIntent.updateMany({
    where: { id: intent.id, status: "ISSUED", userId },
    data: verifiedData,
  });
  if (verified.count !== 1) {
    const latest = await db.listingImageUploadIntent.findUnique({
      where: { id: intent.id },
    });
    if (latest?.status === "VERIFIED" && latest.userId === userId) {
      return { data: latest };
    }
    return { error: "This upload can no longer be verified." };
  }

  return { data: { ...intent, ...verifiedData } };
}

async function expireIssuedIntent(intentId: string, publicId: string) {
  await transitionIntentAndEnqueueCleanup({
    intentId,
    publicId,
    fromStatus: "ISSUED",
    toStatus: "EXPIRED",
    reason: "expired-intent",
  });
}

async function rejectIntent(intentId: string, publicId: string, reason: string) {
  await transitionIntentAndEnqueueCleanup({
    intentId,
    publicId,
    fromStatus: "ISSUED",
    toStatus: "REJECTED",
    reason,
  });
}

async function transitionIntentAndEnqueueCleanup({
  intentId,
  publicId,
  fromStatus,
  toStatus,
  reason,
}: {
  intentId: string;
  publicId: string;
  fromStatus: "ISSUED";
  toStatus: "EXPIRED" | "REJECTED";
  reason: string;
}) {
  await db.$transaction(async (tx) => {
    const updated = await tx.listingImageUploadIntent.updateMany({
      where: { id: intentId, status: fromStatus, image: { is: null } },
      data: { status: toStatus },
    });
    if (updated.count !== 1) {
      return;
    }
    await tx.listingImageCleanupJob.create({
      data: {
        publicId,
        deliveryType: IMAGE_CONSTRAINTS.deliveryType,
        reason,
      },
    });
  });
}
