import { readFile } from "fs/promises";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { getCloudinaryCloudName } from "@/lib/images/cloudinary-url";
import { createSignedListingUpload, getCloudinaryResource } from "@/lib/upload/cloudinary";
import { isIgnoredImageUrl } from "../../scripts/dealer-stock-sync/html-media";
import type { ImageArchiveRecord } from "../../scripts/dealer-stock-sync/types";
import { mapWithConcurrency } from "./concurrency";
import { PREVIEW_PACK_PHOTO_LIMIT, PREVIEW_PACK_UPLOAD_CONCURRENCY } from "./limits";
import { sanitizePreviewSegment } from "./resume";

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

export interface PreviewImageSource {
  localPath: string | null;
  url: string;
  order?: number;
}

export function previewImagePublicId(dealerKey: string, identityKey: string, order: number) {
  return `${IMAGE_CONSTRAINTS.folder}/preview-packs/${sanitizePreviewSegment(dealerKey)}/${sanitizePreviewSegment(identityKey)}/${order}`;
}

function usableArchiveImage(image: ImageArchiveRecord) {
  if (image.status === "ok" && (image.localPath || image.originalUrl)) return true;
  return (
    image.status === "skipped" &&
    image.error === "image mirroring disabled" &&
    Boolean(image.originalUrl)
  );
}

const AUTOFS_NDSTOCK = "://s3-eu-west-1.amazonaws.com/autofs/ndstock/";
const IRELAND_NDSTOCK = "://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/";

export function rewritePreviewImageUrl(url: string) {
  return url.replace(AUTOFS_NDSTOCK, IRELAND_NDSTOCK);
}

export function isLikelyRasterImageBytes(bytes: Buffer) {
  if (bytes.length < 24) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function isUsableCloudinaryPhoto(payload: {
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}) {
  const format = payload.format?.toLowerCase() ?? "";
  if (format === "svg") return false;
  return (payload.width ?? 0) >= 200 && (payload.height ?? 0) >= 200 && (payload.bytes ?? 0) >= 5000;
}

export function isUsablePreviewImageUrl(url: string) {
  const lower = url.toLowerCase();
  if (isIgnoredImageUrl(url)) return false;
  if (lower.includes("pinterest.com") || lower.includes("facebook.com") || lower.includes("twitter.com")) {
    return false;
  }
  if (lower.includes("/themes/") || lower.includes("sold-img") || lower.includes("page-footer")) {
    return false;
  }
  const path = url.split("?")[0]?.split("&")[0] ?? "";
  return /^https?:\/\//i.test(url) && /\.(jpe?g|png|webp)$/i.test(path);
}

function preferFullSizeSources(sources: PreviewImageSource[]) {
  const fullSize = sources.filter(
    (source) => !/-\d+x\d+\.(jpe?g|png|webp)$/i.test(source.url.split("?")[0] ?? ""),
  );
  return fullSize.length > 0 ? fullSize : sources;
}

export function previewImageSources(images: ImageArchiveRecord[], fallbackUrls: string[]) {
  const archived = images.filter(usableArchiveImage).map((image) => ({
    localPath: image.localPath,
    url: rewritePreviewImageUrl(image.originalUrl),
  }));
  const sources = archived.length > 0
    ? archived
    : fallbackUrls.map((url) => ({ localPath: null, url: rewritePreviewImageUrl(url) }));
  return preferFullSizeSources(sources.filter((source) => isUsablePreviewImageUrl(source.url)))
    .slice(0, PREVIEW_PACK_PHOTO_LIMIT);
}

function signedForm(signed: ReturnType<typeof createSignedListingUpload>, file: Blob | string) {
  const form = new FormData();
  if (typeof file === "string") {
    form.append("file", file);
  } else {
    form.append("file", file, "photo.jpg");
  }
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("public_id", signed.publicId);
  form.append("type", signed.type);
  form.append("overwrite", signed.overwrite ? "true" : "false");
  form.append("image_metadata", "false");
  form.append("transformation", signed.transformation);
  return form;
}

async function parseUploadResponse(
  response: Response,
  fallbackUrl: string,
  publicId: string,
  order: number,
): Promise<PreviewUploadedImage> {
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
  if (!response.ok || !payload || !isUsableCloudinaryPhoto(payload)) {
    throw new Error(payload?.error?.message ?? `Cloudinary upload failed for ${fallbackUrl}`);
  }
  return {
    url: payload.secure_url ?? payload.url ?? fallbackUrl,
    publicId,
    order,
    provider: "CLOUDINARY",
    assetId: payload.asset_id ?? null,
    version: payload.version != null ? String(payload.version) : null,
    width: payload.width ?? null,
    height: payload.height ?? null,
    format: payload.format ?? null,
    bytes: payload.bytes ?? null,
  };
}

async function uploadBytes(input: {
  signed: ReturnType<typeof createSignedListingUpload>;
  bytes: Buffer;
  contentType: string;
  fallbackUrl: string;
  publicId: string;
  order: number;
}) {
  const form = signedForm(
    input.signed,
    new Blob([Uint8Array.from(input.bytes)], { type: input.contentType }),
  );
  const response = await fetch(input.signed.uploadUrl, { method: "POST", body: form });
  return parseUploadResponse(response, input.fallbackUrl, input.publicId, input.order);
}

function existingCloudinaryImage(publicId: string, order: number): Promise<PreviewUploadedImage | null> {
  return getCloudinaryResource({ publicId })
    .then((resource) => {
      if (!isUsableCloudinaryPhoto(resource)) return null;
      return {
        url: `https://res.cloudinary.com/${getCloudinaryCloudName()}/image/private/${publicId}`,
        publicId,
        order,
        provider: "CLOUDINARY" as const,
        assetId: resource.assetId,
        version: resource.version,
        width: resource.width,
        height: resource.height,
        format: resource.format,
        bytes: resource.bytes,
      };
    })
    .catch(() => null);
}

async function uploadOneSource(input: {
  dealerKey: string;
  identityKey: string;
  source: PreviewImageSource;
  order: number;
}): Promise<PreviewUploadedImage> {
  const publicId = previewImagePublicId(input.dealerKey, input.identityKey, input.order);
  try {
    return await uploadFreshSource(input, publicId);
  } catch (error) {
    const existing = await existingCloudinaryImage(publicId, input.order);
    if (existing) return existing;
    throw error;
  }
}

async function uploadFreshSource(
  input: {
    dealerKey: string;
    identityKey: string;
    source: PreviewImageSource;
    order: number;
  },
  publicId: string,
) {
  const signed = createSignedListingUpload({ publicId, overwrite: true });
  if (input.source.localPath) {
    const bytes = await readFile(input.source.localPath);
    return uploadBytes({
      signed,
      bytes,
      contentType: "image/jpeg",
      fallbackUrl: input.source.url,
      publicId,
      order: input.order,
    });
  }

  const remoteForm = signedForm(signed, input.source.url);
  const remoteResponse = await fetch(signed.uploadUrl, { method: "POST", body: remoteForm });
  try {
    return await parseUploadResponse(remoteResponse, input.source.url, publicId, input.order);
  } catch {
    const response = await fetch(input.source.url);
    if (!response.ok) {
      throw new Error(`Failed to download preview image ${input.source.url}: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!isLikelyRasterImageBytes(bytes)) {
      throw new Error(`Preview image was not a photo: ${input.source.url}`);
    }
    return uploadBytes({
      signed,
      bytes,
      contentType: response.headers.get("content-type") ?? "image/jpeg",
      fallbackUrl: input.source.url,
      publicId,
      order: input.order,
    });
  }
}

export async function uploadPreviewPackImages(input: {
  dealerKey: string;
  identityKey: string;
  sources: PreviewImageSource[];
}): Promise<PreviewUploadedImage[]> {
  const uploaded = await mapWithConcurrency(
    input.sources,
    PREVIEW_PACK_UPLOAD_CONCURRENCY,
    async (source, index) => {
      try {
        return await uploadOneSource({
          dealerKey: input.dealerKey,
          identityKey: input.identityKey,
          source,
          order: source.order ?? index,
        });
      } catch {
        return null;
      }
    },
  );
  return uploaded.filter((image): image is PreviewUploadedImage => image !== null);
}
