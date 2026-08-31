import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import { createSignedListingUpload } from "../../lib/upload/cloudinary";
import { uniqueImageUrls } from "./map-vehicle";

export interface UploadedListingImage {
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

export function listingImagePublicId(userId: string, listingKey: string, order: number) {
  return `${IMAGE_CONSTRAINTS.folder}/import/${sanitizeSegment(userId)}/${sanitizeSegment(listingKey)}/${order}`;
}

export async function downloadImage(url: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to download image ${url}: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  return { bytes, contentType };
}

export async function uploadListingImages(input: {
  userId: string;
  listingKey: string;
  imageUrls: string[];
  fetchImpl?: typeof fetch;
}): Promise<UploadedListingImage[]> {
  const urls = uniqueImageUrls(input.imageUrls);
  const uploaded: UploadedListingImage[] = [];

  for (const [order, url] of urls.entries()) {
    const publicId = listingImagePublicId(input.userId, input.listingKey, order);
    const signed = createSignedListingUpload({ publicId });
    const { bytes, contentType } = await downloadImage(url, input.fetchImpl);
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

    const response = await (input.fetchImpl ?? fetch)(signed.uploadUrl, {
      method: "POST",
      body: form,
    });
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
      throw new Error(payload?.error?.message ?? `Cloudinary upload failed for ${url}`);
    }
    uploaded.push({
      url: payload.secure_url ?? payload.url ?? url,
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
