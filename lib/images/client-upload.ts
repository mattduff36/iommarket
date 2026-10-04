import { IMAGE_CONSTRAINTS, isAllowedListingImageFormat } from "@/lib/images/constraints";
import type { ListingPhotoSource } from "@/lib/images/photo";

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
        uploadUrl: string;
      };
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

export function validateListingImageFile(file: File) {
  if (file.size > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return `${file.name} is larger than 10MB.`;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeFormat = file.type.replace("image/", "").replace("jpeg", "jpg");
  if (!isAllowedListingImageFormat(extension) && !isAllowedListingImageFormat(mimeFormat)) {
    return `${file.name} must be a JPG, PNG, WebP, HEIC, or HEIF image.`;
  }

  return null;
}

export async function uploadListingImageFile(file: File): Promise<ListingPhotoSource> {
  const intentResponse = await fetch("/api/listing-images/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const intentPayload = (await intentResponse.json().catch(() => null)) as
    | { data?: IssuedUpload; error?: string }
    | null;
  if (!intentResponse.ok || !intentPayload?.data) {
    throw new Error(intentPayload?.error ?? "Could not start the image upload.");
  }

  const { upload, uploadIntentId, publicId } = intentPayload.data;
  if (upload.provider === "imagekit") {
    const imageKitForm = new FormData();
    imageKitForm.append("file", file);
    imageKitForm.append("uploadIntentId", uploadIntentId);
    const imageKitResponse = await fetch(upload.uploadUrl, { method: "POST", body: imageKitForm });
    const imageKitPayload = (await imageKitResponse.json().catch(() => null)) as
      | { data?: FinalizedUpload & { provider?: string; url?: string }; error?: string }
      | null;
    if (!imageKitResponse.ok || !imageKitPayload?.data) {
      throw new Error(imageKitPayload?.error ?? "ImageKit upload failed.");
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

  const cloudinaryResponse = await fetch(upload.uploadUrl, {
    method: "POST",
    body: formData,
  });
  const cloudinaryPayload = (await cloudinaryResponse.json().catch(() => null)) as {
    asset_id?: string;
    version?: string | number;
    error?: { message?: string };
  } | null;
  if (!cloudinaryResponse.ok) {
    throw new Error(cloudinaryPayload?.error?.message ?? "Cloudinary upload failed.");
  }

  const finalizeResponse = await fetch("/api/listing-images/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadIntentId,
      publicId,
      assetId: cloudinaryPayload?.asset_id,
      version: cloudinaryPayload?.version,
    }),
  });
  const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
    | { data?: FinalizedUpload; error?: string }
    | null;
  if (!finalizeResponse.ok || !finalizePayload?.data) {
    throw new Error(finalizePayload?.error ?? "Could not verify the uploaded image.");
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
