import sharp, { type Sharp } from "sharp";
import { IMAGE_CONSTRAINTS, isAllowedListingImageFormat, normalizeImageFormat, validateListingImageBounds } from "@/lib/images/constraints";

const RASTER_FORMATS = new Set(["jpg", "png", "webp"]);

export function listingUploadFormat(fileName: string, mimeType: string) {
  const extension = normalizeImageFormat(fileName.split(".").pop());
  const mimeFormat = normalizeImageFormat(mimeType.replace("image/", ""));
  return isAllowedListingImageFormat(extension) ? extension : mimeFormat;
}

export async function stripListingImageMetadata(input: {
  bytes: Buffer;
  format: string | null;
}) {
  const format = normalizeImageFormat(input.format);
  if (format === "heic" || format === "heif") {
    throw new Error("HEIC/HEIF uploads are explicitly unsupported until this environment can decode and strip them.");
  }
  if (format === "mp4") throw new Error("MP4 is not a listing image format.");
  if (!format || !RASTER_FORMATS.has(format)) {
    throw new Error("ImageKit uploads must be JPG, PNG, or WebP.");
  }
  if (input.bytes.length === 0) throw new Error("The uploaded file is empty.");
  if (input.bytes.length > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    throw new Error("Images must be 10MB or smaller.");
  }

  let image: Sharp;
  try {
    image = sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: IMAGE_CONSTRAINTS.maxMegapixels * 1_000_000,
    }).rotate();
    const metadata = await image.metadata();
    if (normalizeImageFormat(metadata.format) !== format) {
      throw new Error("The file contents do not match the stated format.");
    }
    const boundsError = validateListingImageBounds({
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      bytes: input.bytes.length,
    });
    if (boundsError) throw new Error(boundsError);
  } catch {
    throw new Error("The uploaded image is invalid, unsupported, or outside the allowed dimensions.");
  }

  const encoded = format === "png"
    ? await image.png().toBuffer()
    : format === "webp"
      ? await image.webp().toBuffer()
      : await image.jpeg({ quality: 90 }).toBuffer();
  const stripped = await sharp(encoded).metadata();
  if (stripped.exif || stripped.icc || stripped.xmp || stripped.iptc) {
    throw new Error("Uploaded image metadata could not be stripped.");
  }
  // Input metadata ignores rotate(). The output bytes are the authoritative dimensions.
  const width = stripped.width ?? 0;
  const height = stripped.height ?? 0;
  const boundsError = validateListingImageBounds({ width, height, bytes: encoded.length });
  if (boundsError) throw new Error(boundsError);
  return { bytes: encoded, width, height, format, bytesLength: encoded.length };
}
