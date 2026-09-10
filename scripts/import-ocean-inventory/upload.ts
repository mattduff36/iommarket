import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import {
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "../../lib/images/constraints";
import { downloadSafeRemoteImage } from "../../lib/images/safe-remote-image";
import { createSignedListingUpload, deleteImage } from "../../lib/upload/cloudinary";
import {
  assertOwnedCloudinaryUpload,
  assertOwnedListingAsset,
  destroyOwnedCloudinaryAssets,
  type OwnedCloudinaryAsset,
} from "../../lib/upload/owned-cloudinary-assets";
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
  ownership: OwnedCloudinaryAsset;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function isUsableImportedPhoto(payload: {
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

export function listingImagePublicId(
  userId: string,
  listingKey: string,
  attemptId: string,
  order: number,
) {
  return `${IMAGE_CONSTRAINTS.folder}/import/${sanitizeSegment(userId)}/${sanitizeSegment(listingKey)}/${sanitizeSegment(attemptId)}/${order}`;
}

export async function downloadImage(url: string) {
  const downloaded = await downloadSafeRemoteImage({ url });
  return {
    bytes: downloaded.bytes,
    contentType: downloaded.contentType ?? "application/octet-stream",
  };
}

export async function cleanupImportedListingImages(
  images: UploadedListingImage[],
  destroy: typeof deleteImage = deleteImage,
) {
  if (images.length === 0) return;
  const cloudName = images[0]!.ownership.cloudName;
  await destroyOwnedCloudinaryAssets({
    assets: images.map((image) => image.ownership),
    cloudName,
    allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/import/`,
    destroy: (asset) => destroy(asset.publicId, asset.deliveryType),
  });
}

export async function enqueueImportedListingImageCleanup(
  prisma: PrismaClient,
  images: UploadedListingImage[],
  reason: string,
) {
  for (const image of images) {
    assertOwnedListingAsset({
      asset: image.ownership,
      cloudName: image.ownership.cloudName,
      allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/import/`,
    });
  }
  if (images.length === 0) return;
  await prisma.listingImageCleanupJob.createMany({
    data: images.map((image) => ({
      publicId: image.publicId,
      deliveryType: image.ownership.deliveryType,
      reason,
    })),
  });
}

export async function uploadListingImages(input: {
  userId: string;
  listingKey: string;
  imageUrls: string[];
  fetchImpl?: typeof fetch;
  downloadImpl?: typeof downloadImage;
  destroyImpl?: typeof deleteImage;
  attemptId?: string;
}): Promise<UploadedListingImage[]> {
  const urls = uniqueImageUrls(input.imageUrls);
  const uploaded: UploadedListingImage[] = [];
  const attemptId = input.attemptId ?? randomUUID();
  const download = input.downloadImpl ?? downloadImage;

  try {
    for (const [order, url] of urls.entries()) {
      const publicId = listingImagePublicId(input.userId, input.listingKey, attemptId, order);
      const signed = createSignedListingUpload({ publicId });
      const { bytes, contentType } = await download(url);
      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(bytes)], { type: contentType }),
        `photo-${order}.jpg`,
      );
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
        public_id?: string;
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
      const ownership = assertOwnedCloudinaryUpload({
        payload,
        expectedPublicId: publicId,
        expectedCloudName: signed.cloudName,
        allowedPrefix: `${IMAGE_CONSTRAINTS.folder}/import/`,
      });
      const candidate: UploadedListingImage = {
        url: payload.secure_url ?? payload.url ?? url,
        publicId,
        order: uploaded.length,
        provider: "CLOUDINARY",
        assetId: ownership.assetId,
        version: ownership.version,
        width: payload.width ?? null,
        height: payload.height ?? null,
        format: payload.format ?? null,
        bytes: payload.bytes ?? null,
        ownership,
      };
      if (!isUsableImportedPhoto(payload)) {
        await cleanupImportedListingImages([candidate], input.destroyImpl);
        continue;
      }
      uploaded.push(candidate);
    }
    return uploaded;
  } catch (error) {
    await cleanupImportedListingImages(uploaded, input.destroyImpl);
    throw error;
  }
}
