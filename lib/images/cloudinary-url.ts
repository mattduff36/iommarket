import {
  IMAGE_CONSTRAINTS,
  LISTING_PHOTO_FRAMES,
  LISTING_PHOTO_WIDTHS,
  type ListingPhotoFrame,
} from "@/lib/images/constraints";
import { getListingPhotoFitMode } from "@/lib/images/fit-policy";
import {
  hasValidFocalPoint,
  hasValidPhotoDimensions,
  type ListingPhotoSource,
} from "@/lib/images/photo";

export type ListingPhotoDeliveryMode = "fill" | "fit" | "blur" | "social";

const SOCIAL_WIDTH = 1200;
const SOCIAL_HEIGHT = 630;

function clampWidth(width: number) {
  const requested = Math.max(1, Math.round(width));
  return LISTING_PHOTO_WIDTHS.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest,
  );
}

function encodePublicId(publicId: string) {
  return publicId
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function overlayPublicId(publicId: string) {
  return publicId
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join(":");
}

function gravityForPhoto(photo: ListingPhotoSource) {
  if (!hasValidFocalPoint(photo) || !hasValidPhotoDimensions(photo)) {
    return "g_auto";
  }
  const x = Math.round(photo.focalX! * photo.width!);
  const y = Math.round(photo.focalY! * photo.height!);
  return `g_xy_center,x_${x},y_${y}`;
}

export function getCloudinaryCloudName() {
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
}

export function isTrustedListingPublicId(publicId: string) {
  if (!publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)) return false;
  if (publicId.includes("..") || /\s/.test(publicId)) return false;
  return /^[a-zA-Z0-9/_\-.]+$/.test(publicId);
}

export function buildListingPhotoUrl(
  photo: ListingPhotoSource,
  options: {
    width: number;
    quality?: number | string;
    mode: ListingPhotoDeliveryMode;
    frame: ListingPhotoFrame;
  },
): string {
  if (photo.provider !== "CLOUDINARY" || !isTrustedListingPublicId(photo.publicId)) {
    return photo.url;
  }

  const cloudName = getCloudinaryCloudName();
  if (!cloudName) return photo.url;

  const width = options.mode === "social" ? SOCIAL_WIDTH : clampWidth(options.width);
  const frame = LISTING_PHOTO_FRAMES[options.frame];
  const height =
    options.mode === "social"
      ? SOCIAL_HEIGHT
      : Math.max(1, Math.round((width * frame.height) / frame.width));
  const quality = options.quality ?? "auto";
  const gravity = gravityForPhoto(photo);
  const versionSegment = photo.version ? `v${encodeURIComponent(String(photo.version))}/` : "";
  const encodedPublicId = encodePublicId(photo.publicId);

  const transforms =
    options.mode === "blur"
      ? [`c_fill`, `w_${Math.min(width, 320)}`, `h_${Math.min(height, 200)}`, "e_blur:800", "q_30", "f_auto"]
      : options.mode === "fit"
        ? [`c_fit`, `w_${width}`, `h_${height}`, `q_${quality}`, "f_auto"]
        : options.mode === "social"
          ? buildSocialTransforms(photo, gravity)
        : [`c_fill`, `w_${width}`, `h_${height}`, gravity, `q_${quality}`, "f_auto"];

  return `https://res.cloudinary.com/${cloudName}/image/private/${transforms.join(",")}/${versionSegment}${encodedPublicId}`;
}

export function getListingPhotoSignaturePayload(
  photo: ListingPhotoSource,
  options: {
    width: number;
    quality?: number | string;
    mode: ListingPhotoDeliveryMode;
    frame: ListingPhotoFrame;
  },
) {
  const url = buildListingPhotoUrl(photo, options);
  const marker = "/image/private/";
  const index = url.indexOf(marker);
  if (index < 0) {
    return { url, path: null as string | null };
  }
  return {
    url,
    path: url.slice(index + marker.length),
  };
}

function buildSocialTransforms(photo: ListingPhotoSource, gravity: string) {
  const fitMode = getListingPhotoFitMode({
    sourceWidth: photo.width,
    sourceHeight: photo.height,
    frameWidth: SOCIAL_WIDTH,
    frameHeight: SOCIAL_HEIGHT,
  });

  if (fitMode === "crop") {
    return [`c_fill`, `w_${SOCIAL_WIDTH}`, `h_${SOCIAL_HEIGHT}`, gravity, "f_jpg", "q_auto"];
  }

  return [
    `c_fill,w_${SOCIAL_WIDTH},h_${SOCIAL_HEIGHT},e_blur:800,q_30`,
    `l_private:${overlayPublicId(photo.publicId)},c_fit,w_${SOCIAL_WIDTH},h_${SOCIAL_HEIGHT}`,
    "fl_layer_apply",
    "f_jpg",
    "q_auto",
  ];
}

export function buildSocialImageUrl(photo: ListingPhotoSource) {
  if (photo.provider !== "CLOUDINARY" || !isTrustedListingPublicId(photo.publicId)) {
    return photo.url;
  }
  return buildListingPhotoUrl(photo, {
    width: SOCIAL_WIDTH,
    mode: "social",
    frame: "social",
  });
}

export function buildCanonicalListingImageUrl(photo: Pick<ListingPhotoSource, "publicId" | "version" | "format" | "provider" | "url">) {
  if (photo.provider !== "CLOUDINARY" || !isTrustedListingPublicId(photo.publicId)) {
    return photo.url;
  }
  const cloudName = getCloudinaryCloudName();
  if (!cloudName) return photo.url;
  const versionSegment = photo.version ? `v${encodeURIComponent(String(photo.version))}/` : "";
  const format = photo.format ? `.${encodeURIComponent(photo.format)}` : "";
  return `https://res.cloudinary.com/${cloudName}/image/private/${versionSegment}${encodePublicId(photo.publicId)}${format}`;
}
