import sharp, { type Sharp } from "sharp";
import { isAllowedListingImageFormat, normalizeImageFormat, validateListingImageBounds } from "@/lib/images/constraints";

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
  if (format === "mp4") {
    throw new Error("MP4 is not a listing image format.");
  }
  if (!format || !RASTER_FORMATS.has(format)) {
    throw new Error("Images must be JPG, PNG, WebP, HEIC, or HEIF.");
  }

  let image: Sharp;
  try {
    image = sharp(input.bytes, { failOn: "error" }).rotate();
  } catch {
    throw new Error("The uploaded file could not be read as an image.");
  }
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const encoded =
    format === "png"
      ? await image.png().toBuffer()
      : format === "webp"
        ? await image.webp().toBuffer()
        : await image.jpeg({ quality: 90 }).toBuffer();
  const stripped = await sharp(encoded).metadata();
  if (stripped.exif || stripped.icc || stripped.xmp) {
    throw new Error("Uploaded image metadata could not be stripped.");
  }
  const boundsError = validateListingImageBounds({
    width,
    height,
    bytes: encoded.length,
  });
  if (boundsError) throw new Error(boundsError);
  return { bytes: encoded, width, height, format, bytesLength: encoded.length };
}
