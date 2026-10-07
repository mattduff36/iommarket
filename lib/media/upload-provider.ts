import { readMediaProviderMode } from "@/lib/media/config";
import { IMAGEKIT_DEV_PUBLIC_PREFIX, IMAGEKIT_DISPOSABLE_PREFIX } from "@/lib/media/config";
import { MANAGED_IMAGEKIT_DELIVERY_TYPE, managedMediaPublicId, parseManagedMediaPath } from "@/lib/media/managed-policy";

type UploadIntentIdentity = {
  id?: string;
  userId?: string;
  publicId: string;
  deliveryType: string;
  imageKitFileId?: string | null;
  imageKitFilePath?: string | null;
  folder?: string | null;
};

export const UPLOAD_PROVIDER_CUTOVER_ERROR = "This Cloudinary upload can no longer be used. Please upload the image again.";

/** Writes and delivery have separate preferences so a read rollback can keep native ImageKit uploads. */
export function readMediaUploadProvider(env: Record<string, string | undefined> = process.env): "cloudinary" | "imagekit" {
  const configured = env.MEDIA_PROVIDER?.trim();
  if (configured && !["cloudinary", "imagekit", "imagekit-sample"].includes(configured)) throw new Error("The media delivery provider is invalid.");
  const delivery = readMediaProviderMode(env);
  const explicit = env.MEDIA_UPLOAD_PROVIDER?.trim();
  if (explicit && explicit !== "cloudinary" && explicit !== "imagekit") {
    throw new Error("The media upload provider is invalid.");
  }
  if (delivery === "imagekit" && explicit === "cloudinary") {
    throw new Error("Strict ImageKit delivery cannot accept unmapped Cloudinary uploads.");
  }
  if (explicit === "cloudinary" || explicit === "imagekit") return explicit;
  if (delivery === "imagekit-sample") throw new Error("Sample delivery does not enable listing uploads.");
  return delivery;
}

/**
 * An ImageKit deliveryType alone is not provenance. Require a validated provider identity
 * before allowing an upload intent to create a listing/revision image.
 */
export function hasVerifiedImageKitUploadIdentity(intent: UploadIntentIdentity) {
  const fileId = intent.imageKitFileId;
  const filePath = intent.imageKitFilePath;
  if (!fileId || !/^[A-Za-z0-9_-]{1,100}$/.test(fileId) || !filePath) return false;

  if (intent.deliveryType === MANAGED_IMAGEKIT_DELIVERY_TYPE) {
    const parsed = parseManagedMediaPath(filePath);
    return parsed?.kind === "listings" && parsed.userId === intent.userId && parsed.intentId === intent.id &&
      managedMediaPublicId(filePath) === intent.publicId;
  }

  return intent.deliveryType === "imagekit" && Boolean(intent.id && intent.userId && intent.folder) &&
    intent.folder === `${IMAGEKIT_DISPOSABLE_PREFIX}${intent.userId}/${intent.id}` &&
    filePath.startsWith(`${intent.folder}/`) && intent.publicId === `${IMAGEKIT_DEV_PUBLIC_PREFIX}${fileId}`;
}

export function uploadIntentCanBeAttached(intent: UploadIntentIdentity) {
  return readMediaUploadProvider() !== "imagekit" || hasVerifiedImageKitUploadIdentity(intent);
}
