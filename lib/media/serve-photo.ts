import { IMAGEKIT_PRIVATE_URL_PREFIX, readMediaProviderMode } from "@/lib/media/config";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import { matchMediaReference } from "@/lib/media/match-reference";
import { decideReferenceDelivery } from "@/lib/media/resolve-delivery";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";
import {
  imageKitDeliveryRelativePath,
  imageKitTransformForMode,
  type ImageKitDeliveryMode,
} from "@/lib/media/imagekit-transforms";
import { buildListingPhotoUrl, buildSocialImageUrl } from "@/lib/images/cloudinary-url";
import { signPrivateCloudinaryUrl } from "@/lib/upload/cloudinary";
import type { ListingPhotoFrame } from "@/lib/images/constraints";
import type { ListingPhotoSource } from "@/lib/images/photo";

export function disposablePathFromPhoto(photo: ListingPhotoSource) {
  if (!photo.url.startsWith(IMAGEKIT_PRIVATE_URL_PREFIX)) return null;
  return photo.url.slice(IMAGEKIT_PRIVATE_URL_PREFIX.length);
}

export function resolvedPhotoTarget(photo: ListingPhotoSource, env: NodeJS.ProcessEnv = process.env) {
  const disposablePath = disposablePathFromPhoto(photo);
  const mapPath = env.IMAGEKIT_MIGRATION_MAP;
  const index = mapPath ? loadMigrationIndex(mapPath) : null;
  const match = index
    ? matchMediaReference(photo, index)
    : { kind: "missing" as const, reason: "ImageKit migration map is not configured." };
  return decideReferenceDelivery({ match, env, disposablePath });
}

export function signedDeliveryForPhoto(input: {
  photo: ListingPhotoSource;
  mode: ImageKitDeliveryMode;
  frame: ListingPhotoFrame;
  width: number;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const decision = resolvedPhotoTarget(input.photo, env);
  if (decision.decision === "passthrough") return { kind: "passthrough" as const, url: input.photo.url };
  if (decision.decision === "unresolved") return { kind: "unresolved" as const, reason: decision.reason };
  if (decision.decision === "cloudinary") {
    const built = input.mode === "social"
      ? buildSocialImageUrl(input.photo)
      : buildListingPhotoUrl(input.photo, {
          width: input.width,
          mode: input.mode,
          frame: input.frame,
        });
    return { kind: "redirect" as const, url: signPrivateCloudinaryUrl(built) };
  }

  const disposablePath = disposablePathFromPhoto(input.photo);
  const mapPath = env.IMAGEKIT_MIGRATION_MAP;
  const asset = disposablePath
    ? { destinationPath: disposablePath, resourceType: input.photo.format === "mp4" ? "video" : "image" }
    : mapPath
      ? matchMediaReference(input.photo, loadMigrationIndex(mapPath)).asset
      : undefined;
  if (!asset) return { kind: "unresolved" as const, reason: "Resolved ImageKit asset was missing." };
  const transform = asset.resourceType === "video"
    ? undefined
    : imageKitTransformForMode({
        mode: input.mode,
        frame: input.frame,
        width: input.width,
        photo: input.photo,
      });
  return {
    kind: "redirect" as const,
    url: signedImageKitDeliveryUrl({
      relativePath: imageKitDeliveryRelativePath(asset.destinationPath, transform),
      env,
    }),
  };
}

export function appMediaUrl(path: string, env: NodeJS.ProcessEnv = process.env) {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4010";
  return new URL(path, base).toString();
}

export function listingSocialMetadataUrl(listingId: string, photo: ListingPhotoSource, env: NodeJS.ProcessEnv = process.env) {
  if (readMediaProviderMode(env) === "cloudinary") {
    return signPrivateCloudinaryUrl(buildSocialImageUrl(photo));
  }
  return appMediaUrl(`/api/media/social/${encodeURIComponent(listingId)}`, env);
}

export function structuredListingImageUrl(input: {
  photo: ListingPhotoSource;
  primary: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (readMediaProviderMode(env) === "cloudinary" || !input.photo.id) {
    return signPrivateCloudinaryUrl(
      input.primary
        ? buildSocialImageUrl(input.photo)
        : buildListingPhotoUrl(input.photo, { width: 1200, mode: "fit", frame: "gallery" }),
    );
  }
  const params = new URLSearchParams({
    imageId: input.photo.id,
    source: input.photo.deliverySource ?? "listing",
    mode: input.primary ? "social" : "fit",
    frame: input.primary ? "social" : "gallery",
    w: "1200",
  });
  return appMediaUrl(`/api/media/listing-photo?${params.toString()}`, env);
}
