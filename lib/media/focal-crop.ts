export interface FocalCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocalCropInput {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  focalX: number;
  focalY: number;
}

function assertPositive(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Source rectangle kept by a cover crop whose center is the normalized focal point.
 * Coordinates match Cloudinary `c_fill` with `g_xy_center`.
 */
export function focalCoverCrop(input: FocalCropInput): FocalCropRect {
  assertPositive(input.sourceWidth, "Source width");
  assertPositive(input.sourceHeight, "Source height");
  assertPositive(input.targetWidth, "Target width");
  assertPositive(input.targetHeight, "Target height");
  if (
    !Number.isFinite(input.focalX) ||
    !Number.isFinite(input.focalY) ||
    input.focalX < 0 ||
    input.focalX > 1 ||
    input.focalY < 0 ||
    input.focalY > 1
  ) {
    throw new Error("Focal point must be normalized between 0 and 1.");
  }

  const scale = Math.max(
    input.targetWidth / input.sourceWidth,
    input.targetHeight / input.sourceHeight,
  );
  const width = clamp(Math.round(input.targetWidth / scale), 1, input.sourceWidth);
  const height = clamp(Math.round(input.targetHeight / scale), 1, input.sourceHeight);
  const centerX = input.focalX * input.sourceWidth;
  const centerY = input.focalY * input.sourceHeight;
  const x = clamp(Math.round(centerX - width / 2), 0, input.sourceWidth - width);
  const y = clamp(Math.round(centerY - height / 2), 0, input.sourceHeight - height);
  return { x, y, width, height };
}
