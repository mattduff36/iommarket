import type { ListingPhotoSource } from "@/lib/images/photo";
import { uploadErrorFromPayload } from "@/lib/images/upload-client-error";
import { PHOTO_UNKNOWN_MESSAGE } from "@/lib/media/upload-error-catalog";

export interface DirectImageKitUpload {
  provider: "imagekit";
  strategy: "direct-v2";
  uploadUrl: string;
  finalizeUrl: string;
  fields: Record<string, string>;
}

/** The large body travels directly to ImageKit. Our API receives only two identifiers. */
export async function uploadDirectImageKitPhoto(file: File, uploadIntentId: string, upload: DirectImageKitUpload): Promise<ListingPhotoSource> {
  if (upload.uploadUrl !== "https://upload.imagekit.io/api/v2/files/upload" ||
    upload.finalizeUrl !== "/api/listing-images/imagekit-finalize" ||
    !upload.fields.token || upload.fields.isPrivateFile !== "true" || upload.fields.overwriteFile !== "false") {
    throw new Error("The secure upload configuration is invalid.");
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) {
    if (key === "file" || typeof value !== "string") throw new Error("The secure upload fields are invalid.");
    form.set(key, value);
  }
  form.set("file", file);
  // A V2 JWT is one-use, including failed requests. Never retry the raw upload with the same token.
  const response = await fetch(upload.uploadUrl, {
    method: "POST", body: form, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as { fileId?: unknown } | null;
  if (!response.ok || typeof payload?.fileId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.fileId)) {
    throw new Error("The private image upload failed. Start a new upload to retry.");
  }
  const finalized = await fetch(upload.finalizeUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    body: JSON.stringify({ uploadIntentId, fileId: payload.fileId }), signal: AbortSignal.timeout(130_000),
  });
  const result = await finalized.json().catch(() => null) as { data?: ListingPhotoSource; error?: string } | null;
  if (!finalized.ok || !result?.data || result.data.provider !== "IMAGEKIT" ||
    result.data.uploadIntentId !== uploadIntentId || !result.data.imageKitFileId || !result.data.imageKitFilePath) {
    throw uploadErrorFromPayload(result, PHOTO_UNKNOWN_MESSAGE);
  }
  // Dimensions, format and storage identity come from server verification, never the browser upload response.
  return result.data;
}
