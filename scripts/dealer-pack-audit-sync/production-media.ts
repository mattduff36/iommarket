import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  IMAGE_CONSTRAINTS,
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "../../lib/images/constraints";
import { createSignedListingUpload, deleteImage } from "../../lib/upload/cloudinary";
import { assertOwnedCloudinaryUpload } from "../../lib/upload/owned-cloudinary-assets";
import type {
  ProductionSourceImage,
  ProductionSourceListing,
} from "./production-types";

export interface ProductionUploadedImage {
  url: string;
  publicId: string;
  order: number;
  provider: "CLOUDINARY";
  assetId: string;
  version: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

const PRODUCTION_REPAIR_PREFIX = `${IMAGE_CONSTRAINTS.folder}/repair/dealer-pack-audit/`;

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function validateProductionUploadSet(input: {
  source: ProductionSourceListing;
  uploaded: ProductionUploadedImage[];
}) {
  const errors: string[] = [];
  if (input.uploaded.length !== input.source.images.length) errors.push("image-count");
  const publicIds = new Set<string>();
  const assetIds = new Set<string>();
  input.uploaded.forEach((image, index) => {
    if (image.order !== index) errors.push("image-order");
    if (!image.publicId.startsWith(PRODUCTION_REPAIR_PREFIX)) errors.push("image-prefix");
    if (publicIds.has(image.publicId)) errors.push("duplicate-public-id");
    if (assetIds.has(image.assetId)) errors.push("duplicate-asset-id");
    publicIds.add(image.publicId);
    assetIds.add(image.assetId);
    if (
      !isAllowedListingImageFormat(image.format) ||
      validateListingImageBounds(image) !== null
    ) {
      errors.push("image-quality");
    }
  });
  if (errors.length > 0) {
    throw new Error(`Production replacement media invalid: ${[...new Set(errors)].join(",")}`);
  }
}

async function assertFrozenImage(image: ProductionSourceImage) {
  const bytes = await readFile(image.localPath);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== image.checksum) {
    throw new Error(`Frozen production source image changed: ${image.sourceUrl}`);
  }
  return bytes;
}

async function uploadOne(input: {
  image: ProductionSourceImage;
  publicId: string;
  fetchImpl: typeof fetch;
}) {
  const bytes = await assertFrozenImage(input.image);
  const signed = createSignedListingUpload({ publicId: input.publicId });
  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(bytes)], { type: input.image.contentType }),
    `photo-${input.image.order}.img`,
  );
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("public_id", signed.publicId);
  form.append("type", signed.type);
  form.append("overwrite", "false");
  form.append("image_metadata", "false");
  form.append("transformation", signed.transformation);
  const response = await input.fetchImpl(signed.uploadUrl, { method: "POST", body: form });
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
    throw new Error(payload?.error?.message ?? "Production replacement upload failed.");
  }
  const ownership = assertOwnedCloudinaryUpload({
    payload,
    expectedPublicId: input.publicId,
    expectedCloudName: signed.cloudName,
    allowedPrefix: PRODUCTION_REPAIR_PREFIX,
  });
  if (
    !(payload.secure_url ?? payload.url) ||
    !payload.width ||
    !payload.height ||
    !payload.format ||
    !payload.bytes ||
    validateListingImageBounds({
      width: payload.width,
      height: payload.height,
      bytes: payload.bytes,
    }) !== null ||
    !isAllowedListingImageFormat(payload.format)
  ) {
    try {
      await deleteImage(ownership.publicId, ownership.deliveryType);
    } catch (cleanupError) {
      throw new Error(
        `Production replacement failed quality validation and cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
    throw new Error("Production replacement upload failed image quality validation.");
  }
  return {
    url: payload.secure_url ?? payload.url ?? "",
    publicId: ownership.publicId,
    order: input.image.order,
    provider: "CLOUDINARY" as const,
    assetId: ownership.assetId,
    version: ownership.version,
    width: payload.width,
    height: payload.height,
    format: payload.format,
    bytes: payload.bytes,
  };
}

export async function cleanupProductionUploads(
  images: ProductionUploadedImage[],
  destroy: typeof deleteImage = deleteImage,
) {
  const results = await Promise.allSettled(
    images.map((image) => destroy(image.publicId, IMAGE_CONSTRAINTS.deliveryType)),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${images[index]?.publicId}:${result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)}`]
      : []);
  if (failures.length > 0) {
    throw new Error(`Production upload cleanup failed: ${failures.join(";")}`);
  }
}

export async function uploadProductionReplacement(input: {
  runId: string;
  dealerKey: string;
  source: ProductionSourceListing;
  fetchImpl?: typeof fetch;
}) {
  const uploaded: ProductionUploadedImage[] = [];
  const attempt = randomUUID();
  try {
    for (const image of input.source.images) {
      const publicId = [
        PRODUCTION_REPAIR_PREFIX.slice(0, -1),
        sanitize(input.runId),
        sanitize(input.dealerKey),
        sanitize(input.source.managedKey),
        attempt,
        String(image.order),
      ].join("/");
      uploaded.push(await uploadOne({
        image,
        publicId,
        fetchImpl: input.fetchImpl ?? fetch,
      }));
    }
    validateProductionUploadSet({ source: input.source, uploaded });
    return uploaded;
  } catch (error) {
    try {
      await cleanupProductionUploads(uploaded);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
    throw error;
  }
}

export { PRODUCTION_REPAIR_PREFIX };
