import { readFile } from "fs/promises";
import type { PrismaClient } from "@prisma/client";
import {
  IMAGE_CONSTRAINTS,
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "@/lib/images/constraints";
import {
  detectSafeRasterContentType,
  downloadSafeRemoteImage,
} from "@/lib/images/safe-remote-image";
import {
  createSignedListingUpload,
  deleteImage,
} from "@/lib/upload/cloudinary";
import {
  assertOwnedCloudinaryUpload,
  assertOwnedListingAsset,
  destroyOwnedCloudinaryAssets,
  type OwnedCloudinaryAsset,
} from "@/lib/upload/owned-cloudinary-assets";
import { isIgnoredImageUrl } from "../../scripts/dealer-stock-sync/html-media";
import {
  parseNetDirectorImageToken,
  rewriteNdstockUrl,
  uniqueImageSources,
} from "../../scripts/dealer-stock-sync/image-urls";
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
  ownership: OwnedCloudinaryAsset | null;
}

export interface PreviewImageSource {
  localPath: string | null;
  url: string;
  order?: number;
}

export function previewImagePublicId(
  dealerKey: string,
  identityKey: string,
  attemptId: string,
  order: number,
) {
  return `${IMAGE_CONSTRAINTS.folder}/preview-packs/${sanitizePreviewSegment(dealerKey)}/${sanitizePreviewSegment(identityKey)}/${sanitizePreviewSegment(attemptId)}/${order}`;
}

function usableArchiveImage(image: ImageArchiveRecord) {
  if (image.status === "ok" && (image.localPath || image.originalUrl)) return true;
  return (
    image.status === "skipped" &&
    image.error === "image mirroring disabled" &&
    Boolean(image.originalUrl)
  );
}

export function rewritePreviewImageUrl(url: string) {
  return rewriteNdstockUrl(url);
}

function isUsableCloudinaryPhoto(payload: {
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}) {
  return (
    isAllowedListingImageFormat(payload.format) &&
    validateListingImageBounds({
      width: payload.width ?? 0,
      height: payload.height ?? 0,
      bytes: payload.bytes ?? 0,
    }) === null
  );
}

export function isUsablePreviewImageUrl(url: string) {
  const lower = url.toLowerCase();
  if (isIgnoredImageUrl(url)) return false;
  if (lower.includes("pinterest.com") || lower.includes("facebook.com") || lower.includes("twitter.com")) {
    return false;
  }
  if (
    lower.includes("/themes/") ||
    lower.includes("sold-img") ||
    lower.includes("page-footer") ||
    lower.includes("manufacturer-icons") ||
    lower.includes("apple-touch-icon") ||
    lower.includes("android-chrome") ||
    lower.includes("/make50px/")
  ) {
    return false;
  }
  const path = url.split("?")[0]?.split("&")[0] ?? "";
  if (parseNetDirectorImageToken(url) || /images\.netdirector\.auto/i.test(url)) {
    return /^https?:\/\//i.test(url);
  }
  return /^https?:\/\//i.test(url) && /\.(jpe?g|png|webp)$/i.test(path);
}

function preferFullSizeSources(sources: PreviewImageSource[]) {
  return uniqueImageSources(sources, sources.length);
}

export function previewImageSources(
  images: ImageArchiveRecord[],
  fallbackUrls: string[],
  limit = PREVIEW_PACK_PHOTO_LIMIT,
) {
  const archived = images.filter(usableArchiveImage).map((image) => ({
    localPath: image.localPath,
    url: rewritePreviewImageUrl(image.originalUrl),
  }));
  const sources = [
    ...archived,
    ...fallbackUrls.map((url) => ({ localPath: null, url: rewritePreviewImageUrl(url) })),
  ];
  return preferFullSizeSources(sources.filter((source) => isUsablePreviewImageUrl(source.url)))
    .slice(0, limit);
}

function signedForm(signed: ReturnType<typeof createSignedListingUpload>, file: Blob) {
  const form = new FormData();
  form.append("file", file, "photo.jpg");
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
  cloudName: string,
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
    public_id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error?.message ?? `Cloudinary upload failed for ${fallbackUrl}`);
  }
  const ownership = assertOwnedCloudinaryUpload({
    payload,
    expectedPublicId: publicId,
    expectedCloudName: cloudName,
    allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/preview-packs/`,
  });
  if (!isUsableCloudinaryPhoto(payload)) {
    await destroyOwnedCloudinaryAssets({
      assets: [ownership],
      cloudName,
      allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/preview-packs/`,
      destroy: (asset) => deleteImage(asset.publicId, asset.deliveryType),
    });
    throw new Error(`Cloudinary upload was not a usable preview photo for ${fallbackUrl}`);
  }
  return {
    url: payload.secure_url ?? payload.url ?? fallbackUrl,
    publicId,
    order,
    provider: "CLOUDINARY",
    assetId: ownership.assetId,
    version: ownership.version,
    width: payload.width ?? null,
    height: payload.height ?? null,
    format: payload.format ?? null,
    bytes: payload.bytes ?? null,
    ownership,
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
  return parseUploadResponse(
    response,
    input.fallbackUrl,
    input.publicId,
    input.order,
    input.signed.cloudName,
  );
}

async function uploadOneSource(input: {
  dealerKey: string;
  identityKey: string;
  source: PreviewImageSource;
  order: number;
  attemptId: string;
  downloadImpl?: typeof downloadSafeRemoteImage;
}): Promise<PreviewUploadedImage> {
  const publicId = previewImagePublicId(
    input.dealerKey,
    input.identityKey,
    input.attemptId,
    input.order,
  );
  return uploadFreshSource(input, publicId);
}

async function uploadFreshSource(
  input: {
    dealerKey: string;
    identityKey: string;
    source: PreviewImageSource;
    order: number;
    downloadImpl?: typeof downloadSafeRemoteImage;
  },
  publicId: string,
) {
  const signed = createSignedListingUpload({ publicId, overwrite: false });
  if (input.source.localPath) {
    const bytes = await readFile(input.source.localPath);
    const contentType = detectSafeRasterContentType(bytes);
    return uploadBytes({
      signed,
      bytes,
      contentType,
      fallbackUrl: input.source.url,
      publicId,
      order: input.order,
    });
  }

  const downloaded = await (input.downloadImpl ?? downloadSafeRemoteImage)({
    url: input.source.url,
  });
  return uploadBytes({
    signed,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType ?? "application/octet-stream",
    fallbackUrl: input.source.url,
    publicId,
    order: input.order,
  });
}

export async function uploadPreviewPackImages(input: {
  dealerKey: string;
  identityKey: string;
  sources: PreviewImageSource[];
  attemptId: string;
  downloadImpl?: typeof downloadSafeRemoteImage;
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
          attemptId: input.attemptId,
          downloadImpl: input.downloadImpl,
        });
      } catch {
        return null;
      }
    },
  );
  return uploaded.filter((image): image is PreviewUploadedImage => image !== null);
}

export async function cleanupPreviewUploadedImages(
  images: PreviewUploadedImage[],
  destroy: typeof deleteImage = deleteImage,
) {
  const owned = images
    .map((image) => image.ownership)
    .filter((asset): asset is OwnedCloudinaryAsset => asset !== null);
  if (owned.length === 0) return;
  await destroyOwnedCloudinaryAssets({
    assets: owned,
    cloudName: owned[0]!.cloudName,
    allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/preview-packs/`,
    destroy: (asset) => destroy(asset.publicId, asset.deliveryType),
  });
}

export async function enqueuePreviewUploadedImageCleanup(
  prisma: PrismaClient,
  images: PreviewUploadedImage[],
  reason: string,
) {
  const owned = images
    .map((image) => image.ownership)
    .filter((asset): asset is OwnedCloudinaryAsset => asset !== null);
  for (const asset of owned) {
    assertOwnedListingAsset({
      asset,
      cloudName: owned[0]!.cloudName,
      allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/preview-packs/`,
    });
  }
  if (owned.length === 0) return;
  await prisma.listingImageCleanupJob.createMany({
    data: owned.map((asset) => ({
      publicId: asset.publicId,
      deliveryType: asset.deliveryType,
      reason,
    })),
  });
}
