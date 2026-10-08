import { uploadDirectImageKitPhoto, type DirectImageKitUpload } from "@/lib/images/imagekit-client-upload";
import {
  IMAGE_CONSTRAINTS,
  isAllowedListingImageFormat,
  normalizeImageFormat,
  validateListingImageBounds,
} from "@/lib/images/constraints";
import type { ListingPhotoSource } from "@/lib/images/photo";
import {
  normalizeUploadClientError,
  presentClientUploadError,
  uploadErrorFromPayload,
  UploadClientError,
} from "@/lib/images/upload-client-error";
import { PHOTO_START_MESSAGE, PHOTO_UNKNOWN_MESSAGE } from "@/lib/media/upload-error-catalog";

export { presentClientUploadError, UploadClientError };

interface IssuedUpload {
  uploadIntentId: string;
  publicId: string;
  upload:
    | {
        provider?: undefined;
        cloudName: string;
        apiKey: string;
        timestamp: number;
        signature: string;
        publicId: string;
        type: string;
        transformation: string;
        uploadUrl: string;
      }
    | {
        provider: "imagekit";
        strategy?: undefined;
        uploadUrl: string;
      }
    | DirectImageKitUpload;
}

interface FinalizedUpload {
  uploadIntentId: string;
  publicId: string;
  assetId: string | null;
  version: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
}

export function publicImageFileLabel(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001F\u007F]/g, "").replace(/https?:\/\//gi, "").trim() ?? "";
  const label = base.slice(0, 80).trim();
  return label.length > 0 ? label : "This photo";
}

export function undersizedPhotoMessage(fileName: string, width: number, height: number): string {
  return `${publicImageFileLabel(fileName)} is ${width}×${height} pixels. Photos need a long edge of at least ${IMAGE_CONSTRAINTS.minLongEdge} pixels and a short edge of at least ${IMAGE_CONSTRAINTS.minShortEdge} pixels. Choose a larger original photo.`;
}

export function validateListingImageFile(file: File) {
  const label = publicImageFileLabel(file.name);
  if (file.size > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return `${label} is larger than 10MB.`;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeFormat = file.type.replace("image/", "").replace("jpeg", "jpg");
  if (!isAllowedListingImageFormat(extension) && !isAllowedListingImageFormat(mimeFormat)) {
    return `${label} must be a JPG, PNG, WebP, HEIC, or HEIF image.`;
  }

  return null;
}

function fileFormat(file: File): string | null {
  return normalizeImageFormat(file.name.split(".").pop()) ?? normalizeImageFormat(file.type.replace("image/", ""));
}

function isHeifFile(file: File): boolean {
  const format = fileFormat(file);
  return format === "heic" || format === "heif";
}

function isBrowserRaster(file: File): boolean {
  const format = fileFormat(file);
  return format === "jpg" || format === "png" || format === "webp";
}

async function decodeRaster(file: File): Promise<{ width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  try {
    const { width, height } = bitmap;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 100_000 || height > 100_000) {
      throw new Error("unreadable");
    }
    return { width, height };
  } finally {
    bitmap.close();
  }
}

/** Size and type, then pixel size for browser-decodable rasters. HEIF stays with the server. */
export async function preflightListingImageFile(file: File): Promise<string | null> {
  if (file.size <= 0) return "The uploaded file is empty.";
  const basic = validateListingImageFile(file);
  if (basic) return basic;
  if (isHeifFile(file) || !isBrowserRaster(file) || typeof createImageBitmap !== "function") return null;
  try {
    const size = await decodeRaster(file);
    const bounds = validateListingImageBounds({ width: size.width, height: size.height, bytes: file.size });
    if (!bounds) return null;
    if (bounds.startsWith("Images must be at least")) return undersizedPhotoMessage(file.name, size.width, size.height);
    return bounds;
  } catch {
    return `${publicImageFileLabel(file.name)} could not be read. Choose a JPG, PNG, or WebP photo, or select it again.`;
  }
}

async function transmitListingImageFile(file: File): Promise<ListingPhotoSource> {
  let intentResponse: Response;
  try {
    intentResponse = await fetch("/api/listing-images/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
    });
  } catch (error) {
    throw normalizeUploadClientError(error);
  }
  const intentPayload = (await intentResponse.json().catch(() => null)) as
    | { data?: IssuedUpload; error?: string }
    | null;
  if (!intentResponse.ok || !intentPayload?.data) {
    throw uploadErrorFromPayload(intentPayload, PHOTO_START_MESSAGE);
  }

  const { upload, uploadIntentId, publicId } = intentPayload.data;
  if (upload.provider === "imagekit" && upload.strategy === "direct-v2") {
    return uploadDirectImageKitPhoto(file, uploadIntentId, upload);
  }
  if (upload.provider === "imagekit") {
    const imageKitForm = new FormData();
    imageKitForm.append("file", file);
    imageKitForm.append("uploadIntentId", uploadIntentId);
    let imageKitResponse: Response;
    try {
      imageKitResponse = await fetch(upload.uploadUrl, { method: "POST", body: imageKitForm });
    } catch (error) {
      throw normalizeUploadClientError(error);
    }
    const imageKitPayload = (await imageKitResponse.json().catch(() => null)) as
      | { data?: FinalizedUpload & { provider?: string; url?: string }; error?: string }
      | null;
    if (!imageKitResponse.ok || !imageKitPayload?.data) {
      throw uploadErrorFromPayload(imageKitPayload, PHOTO_UNKNOWN_MESSAGE);
    }
    return {
      uploadIntentId: imageKitPayload.data.uploadIntentId,
      url: imageKitPayload.data.url ?? "",
      publicId: imageKitPayload.data.publicId,
      provider: "EXTERNAL",
      assetId: imageKitPayload.data.assetId,
      version: imageKitPayload.data.version,
      width: imageKitPayload.data.width,
      height: imageKitPayload.data.height,
      format: imageKitPayload.data.format,
      bytes: imageKitPayload.data.bytes,
    };
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", upload.apiKey);
  formData.append("timestamp", String(upload.timestamp));
  formData.append("signature", upload.signature);
  formData.append("public_id", upload.publicId);
  formData.append("type", upload.type);
  formData.append("overwrite", "false");
  formData.append("image_metadata", "false");
  formData.append("transformation", upload.transformation);

  let cloudinaryResponse: Response;
  try {
    cloudinaryResponse = await fetch(upload.uploadUrl, { method: "POST", body: formData });
  } catch (error) {
    throw normalizeUploadClientError(error);
  }
  const cloudinaryPayload = (await cloudinaryResponse.json().catch(() => null)) as {
    asset_id?: string;
    version?: string | number;
    error?: { message?: string };
  } | null;
  if (!cloudinaryResponse.ok) {
    // Provider text is not a safe reason and is not proof the file itself is invalid.
    throw new UploadClientError(PHOTO_UNKNOWN_MESSAGE, { code: "unknown", retryable: false });
  }

  let finalizeResponse: Response;
  try {
    finalizeResponse = await fetch("/api/listing-images/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadIntentId,
        publicId,
        assetId: cloudinaryPayload?.asset_id,
        version: cloudinaryPayload?.version,
      }),
    });
  } catch (error) {
    throw normalizeUploadClientError(error);
  }
  const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
    | { data?: FinalizedUpload; error?: string }
    | null;
  if (!finalizeResponse.ok || !finalizePayload?.data) {
    throw uploadErrorFromPayload(finalizePayload, PHOTO_UNKNOWN_MESSAGE);
  }

  return {
    uploadIntentId: finalizePayload.data.uploadIntentId,
    url: "",
    publicId: finalizePayload.data.publicId,
    provider: "CLOUDINARY",
    assetId: finalizePayload.data.assetId,
    version: finalizePayload.data.version,
    width: finalizePayload.data.width,
    height: finalizePayload.data.height,
    format: finalizePayload.data.format,
    bytes: finalizePayload.data.bytes,
  };
}

export async function uploadListingImageFile(file: File): Promise<ListingPhotoSource> {
  const rejected = await preflightListingImageFile(file);
  if (rejected) {
    throw new UploadClientError(rejected, { code: "validation", retryable: false });
  }
  try {
    return await transmitListingImageFile(file);
  } catch (error) {
    throw normalizeUploadClientError(error);
  }
}
