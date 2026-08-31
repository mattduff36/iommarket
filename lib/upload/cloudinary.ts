import { createHash } from "node:crypto";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";

export { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";

export function getCloudinaryConfig() {
  return {
    cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  };
}

export function getCloudinaryUploadPreset() {
  return process.env.CLOUDINARY_UPLOAD_PRESET ??
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ??
    "";
}

export function signCloudinaryDeliveryPath(path: string, apiSecret: string) {
  const signature = createHash("sha1")
    .update(`${path}${apiSecret}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return signature.slice(0, 8);
}

export function signPrivateCloudinaryUrl(url: string) {
  const config = getCloudinaryConfig();
  const marker = "/image/private/";
  const index = url.indexOf(marker);
  if (!config.apiSecret || index < 0) return url;
  const path = url.slice(index + marker.length);
  const signature = signCloudinaryDeliveryPath(path, config.apiSecret);
  return `${url.slice(0, index + marker.length)}s--${signature}--/${path}`;
}

export function signCloudinaryParams(
  params: Record<string, string | number>,
  apiSecret: string,
) {
  const signatureBase = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return createHash("sha256").update(`${signatureBase}${apiSecret}`).digest("hex");
}

export interface CloudinaryResource {
  assetId: string;
  publicId: string;
  version: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  resourceType: string;
  type: string;
  folder?: string;
}

interface CloudinaryResourcePayload {
  asset_id?: string;
  public_id?: string;
  version?: string | number;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  resource_type?: string;
  type?: string;
  folder?: string;
  error?: { message?: string };
}

function requireCloudinaryConfig() {
  const config = getCloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error("Cloudinary is not configured.");
  }
  return config;
}

function basicAuthHeader(apiKey: string, apiSecret: string) {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

function parseCloudinaryResource(payload: CloudinaryResourcePayload): CloudinaryResource {
  if (!payload.asset_id || !payload.public_id || payload.version == null) {
    throw new Error(payload.error?.message ?? "Cloudinary did not return a complete resource.");
  }

  return {
    assetId: payload.asset_id,
    publicId: payload.public_id,
    version: String(payload.version),
    width: Number(payload.width ?? 0),
    height: Number(payload.height ?? 0),
    format: String(payload.format ?? ""),
    bytes: Number(payload.bytes ?? 0),
    resourceType: payload.resource_type ?? "image",
    type: payload.type ?? IMAGE_CONSTRAINTS.deliveryType,
    folder: payload.folder,
  };
}

export async function getCloudinaryResource({
  publicId,
  deliveryType = IMAGE_CONSTRAINTS.deliveryType,
}: {
  publicId: string;
  deliveryType?: string;
}): Promise<CloudinaryResource> {
  const config = requireCloudinaryConfig();
  const encodedPublicId = encodeURIComponent(publicId);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/${deliveryType}/${encodedPublicId}`,
    {
      headers: {
        Authorization: basicAuthHeader(config.apiKey, config.apiSecret),
      },
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as CloudinaryResourcePayload | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error?.message ?? `Failed to load Cloudinary resource: ${response.status}`);
  }
  return parseCloudinaryResource(payload);
}

export async function deleteImage(
  publicId: string,
  deliveryType: string = IMAGE_CONSTRAINTS.deliveryType,
): Promise<void> {
  const config = requireCloudinaryConfig();
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    public_id: publicId,
    timestamp,
    type: deliveryType,
  };
  const signature = signCloudinaryParams(params, config.apiSecret);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        public_id: publicId,
        timestamp: String(timestamp),
        type: deliveryType,
        api_key: config.apiKey,
        signature,
      }).toString(),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to delete image: ${response.statusText}`);
  }
}

export function createSignedListingUpload({
  publicId,
  timestamp = Math.round(Date.now() / 1000),
  overwrite = false,
}: {
  publicId: string;
  timestamp?: number;
  overwrite?: boolean;
}) {
  const config = requireCloudinaryConfig();
  const params = {
    image_metadata: "false",
    overwrite: overwrite ? "true" : "false",
    public_id: publicId,
    timestamp,
    transformation: "fl_force_strip",
    type: IMAGE_CONSTRAINTS.deliveryType,
  };
  const signature = signCloudinaryParams(params, config.apiSecret);

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    signature,
    publicId,
    type: IMAGE_CONSTRAINTS.deliveryType,
    transformation: params.transformation,
    imageMetadata: false,
    overwrite,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
  };
}
