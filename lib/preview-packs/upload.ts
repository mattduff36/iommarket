import { readFile } from "fs/promises";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { createSignedListingUpload } from "@/lib/upload/cloudinary";
import type { ImageArchiveRecord } from "../../scripts/dealer-stock-sync/types";

export interface PreviewUploadedImage {
  url: string;
  publicId: string;
  order: number;
  provider: "CLOUDINARY";
  assetId: string | null;
  version: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function previewImagePublicId(dealerKey: string, identityKey: string, order: number) {
  return `${IMAGE_CONSTRAINTS.folder}/preview-packs/${sanitizeSegment(dealerKey)}/${sanitizeSegment(identityKey)}/${order}`;
}

export function previewImageSources(images: ImageArchiveRecord[], fallbackUrls: string[]) {
  const archived = images.filter((image) => image.status === "ok" && (image.localPath || image.originalUrl));
  if (archived.length > 0) {
    return archived.map((image) => ({
      localPath: image.localPath,
      url: image.originalUrl,
    }));
  }
  return fallbackUrls.map((url) => ({ localPath: null, url }));
}

async function readImageBytes(input: { localPath: string | null; url: string }) {
  if (input.localPath) {
    const bytes = await readFile(input.localPath);
    return { bytes, contentType: "image/jpeg" };
  }
  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`Failed to download preview image ${input.url}: ${response.status}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/jpeg",
  };
}

export async function uploadPreviewPackImages(input: {
  dealerKey: string;
  identityKey: string;
  sources: Array<{ localPath: string | null; url: string }>;
}): Promise<PreviewUploadedImage[]> {
  const uploaded: PreviewUploadedImage[] = [];
  for (const [order, source] of input.sources.entries()) {
    const publicId = previewImagePublicId(input.dealerKey, input.identityKey, order);
    const signed = createSignedListingUpload({ publicId });
    const { bytes, contentType } = await readImageBytes(source);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), `photo-${order}.jpg`);
    form.append("api_key", signed.apiKey);
    form.append("timestamp", String(signed.timestamp));
    form.append("signature", signed.signature);
    form.append("public_id", signed.publicId);
    form.append("type", signed.type);
    form.append("overwrite", "false");
    form.append("image_metadata", "false");
    form.append("transformation", signed.transformation);

    const response = await fetch(signed.uploadUrl, { method: "POST", body: form });
    const payload = (await response.json().catch(() => null)) as {
      secure_url?: string;
      url?: string;
      asset_id?: string;
      version?: string | number;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.error?.message ?? `Cloudinary upload failed for ${source.url}`);
    }
    uploaded.push({
      url: payload.secure_url ?? payload.url ?? source.url,
      publicId,
      order,
      provider: "CLOUDINARY",
      assetId: payload.asset_id ?? null,
      version: payload.version != null ? String(payload.version) : null,
      width: payload.width ?? null,
      height: payload.height ?? null,
      format: payload.format ?? null,
      bytes: payload.bytes ?? null,
    });
  }
  return uploaded;
}
