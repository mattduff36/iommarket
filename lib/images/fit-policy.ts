import { LISTING_PHOTO_FIT_THRESHOLD } from "@/lib/images/constraints";

export type ListingPhotoFitMode = "crop" | "pad";

export function getRetainedVisibleFraction(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): number | null {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return null;
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frameWidth / frameHeight;
  return Math.min(sourceRatio / frameRatio, frameRatio / sourceRatio);
}

export function getListingPhotoFitMode({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
}: {
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  frameWidth: number;
  frameHeight: number;
}): ListingPhotoFitMode {
  const retained = getRetainedVisibleFraction(
    sourceWidth ?? 0,
    sourceHeight ?? 0,
    frameWidth,
    frameHeight,
  );
  if (retained === null) return "pad";
  return retained >= LISTING_PHOTO_FIT_THRESHOLD ? "crop" : "pad";
}
