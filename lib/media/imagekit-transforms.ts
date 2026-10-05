import { LISTING_PHOTO_FRAMES, type ListingPhotoFrame } from "@/lib/images/constraints";
import {
  LISTING_PHOTO_DELIVERY_WIDTHS,
  isListingPhotoDeliveryWidth,
} from "@/lib/images/delivery-widths";
import { getListingPhotoFitMode } from "@/lib/images/fit-policy";
import { hasValidFocalPoint, hasValidPhotoDimensions, type ListingPhotoSource } from "@/lib/images/photo";
import { focalCoverCrop } from "@/lib/media/focal-crop";

export const SOCIAL_WIDTH = 1200;
export const SOCIAL_HEIGHT = 630;

export type ImageKitDeliveryMode = "fill" | "fit" | "blur" | "social";

/**
 * Delivery widths pass through unchanged. Other values are a server-side
 * backstop only: the media route rejects them before a transform is built.
 */
export function clampListingPhotoWidth(width: number) {
  const requested = Math.max(1, Math.round(width));
  if (isListingPhotoDeliveryWidth(requested)) return requested;
  return LISTING_PHOTO_DELIVERY_WIDTHS.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest,
  );
}

export function framePixelSize(frame: ListingPhotoFrame, width: number) {
  const ratio = LISTING_PHOTO_FRAMES[frame];
  return {
    width,
    height: Math.max(1, Math.round((width * ratio.height) / ratio.width)),
  };
}

function positiveTransformSize(width: number, height: number) {
  return `w-${Math.max(1, Math.round(width))},h-${Math.max(1, Math.round(height))}`;
}

export function imageKitFitTransform(width: number, height: number) {
  return `${positiveTransformSize(width, height)},c-at_max`;
}

export function imageKitFillTransform(input: {
  width: number;
  height: number;
  photo?: Pick<ListingPhotoSource, "width" | "height" | "focalX" | "focalY">;
}) {
  const base = `${positiveTransformSize(input.width, input.height)},c-maintain_ratio`;
  if (!input.photo || !hasValidFocalPoint(input.photo) || !hasValidPhotoDimensions(input.photo)) {
    return base;
  }
  const crop = focalCoverCrop({
    sourceWidth: input.photo.width!,
    sourceHeight: input.photo.height!,
    targetWidth: input.width,
    targetHeight: input.height,
    focalX: input.photo.focalX!,
    focalY: input.photo.focalY!,
  });
  return `x-${crop.x},y-${crop.y},w-${crop.width},h-${crop.height},cm-extract:${positiveTransformSize(input.width, input.height)},c-force`;
}

export function imageKitBlurTransform(width: number, height: number) {
  return `${positiveTransformSize(Math.min(width, 320), Math.min(height, 200))},c-maintain_ratio,bl-10`;
}

export function imageKitSocialTransform(
  photo: Pick<ListingPhotoSource, "width" | "height" | "focalX" | "focalY">,
) {
  const fitMode = getListingPhotoFitMode({
    sourceWidth: photo.width,
    sourceHeight: photo.height,
    frameWidth: SOCIAL_WIDTH,
    frameHeight: SOCIAL_HEIGHT,
  });
  if (fitMode === "pad") {
    return `w-${SOCIAL_WIDTH},h-${SOCIAL_HEIGHT},cm-pad_resize,bg-blurred,f-jpg`;
  }
  return `${imageKitFillTransform({
    width: SOCIAL_WIDTH,
    height: SOCIAL_HEIGHT,
    photo,
  })},f-jpg`;
}

export function imageKitTransformForMode(input: {
  mode: ImageKitDeliveryMode;
  frame: ListingPhotoFrame;
  width: number;
  photo?: Pick<ListingPhotoSource, "width" | "height" | "focalX" | "focalY">;
}) {
  if (input.mode === "social") {
    return imageKitSocialTransform(input.photo ?? {});
  }
  const size = framePixelSize(input.frame, clampListingPhotoWidth(input.width));
  if (input.mode === "fit") return imageKitFitTransform(size.width, size.height);
  if (input.mode === "blur") return imageKitBlurTransform(size.width, size.height);
  return imageKitFillTransform({ ...size, photo: input.photo });
}

export function imageKitDeliveryRelativePath(filePath: string, transform?: string) {
  const normalized = filePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("ImageKit file path is not allowed.");
  }
  if (!transform) return normalized;
  if (!/^[a-z0-9,:_-]+$/i.test(transform)) {
    throw new Error("ImageKit transform is not allowed.");
  }
  return `tr:${transform}/${normalized}`;
}
