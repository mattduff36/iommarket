import { lookup } from "node:dns/promises";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import { signCloudinaryParams } from "../../lib/upload/cloudinary";
import { fileSha256 } from "./identity";
import type { ImageArchiveRecord } from "../dealer-stock-sync/types";

export class FoundingSkippableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundingSkippableImageError";
  }
}

export interface FoundingCloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface FoundingUploadedImage {
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

export function assertPathInsideArchive(archiveDir: string, localPath: string) {
  const root = resolve(archiveDir);
  const candidate = resolve(isAbsolute(localPath) ? localPath : joinArchive(root, localPath));
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Refusing founding onboard: image path escapes the archive directory.");
  }
  if (rel.split(sep).includes("..")) {
    throw new Error("Refusing founding onboard: image path escapes the archive directory.");
  }
  return candidate;
}

function joinArchive(root: string, localPath: string) {
  return normalize(resolve(root, localPath));
}

export function assertSafeRemoteUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Refusing founding onboard: invalid image URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Refusing founding onboard: remote images must use HTTPS.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  ) {
    throw new Error("Refusing founding onboard: remote image host is not allowed.");
  }
  return parsed;
}

export function isPrivateIpAddress(address: string) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::1" || value === "::" || value === "0.0.0.0") return true;
  if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("::ffff:")) return isPrivateIpAddress(value.slice(7));
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!ipv4) return false;
  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
}

export async function resolvePublicRemoteAddresses(hostname: string) {
  let results: Array<{ address: string }>;
  try {
    results = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new FoundingSkippableImageError(`Failed to resolve image host ${hostname}.`);
  }
  const addresses = results.map((result) => result.address).filter((address) => !isPrivateIpAddress(address));
  if (addresses.length === 0) {
    throw new Error("Refusing founding onboard: remote image host resolved to a private address.");
  }
  return addresses;
}

export async function assertResolvedRemoteHostPublic(hostname: string) {
  await resolvePublicRemoteAddresses(hostname);
}

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  skippable: boolean,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  const message = lastError instanceof Error ? lastError.message : "fetch failed";
  if (skippable) throw new FoundingSkippableImageError(message);
  throw new Error(message);
}

export async function downloadViaFetch(url: URL, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response.ok) {
    throw new FoundingSkippableImageError(`Failed to download image ${url.href}: ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function downloadPinnedHttps(url: URL, addresses: string[]) {
  const address = addresses[0];
  if (!address) {
    throw new Error("Refusing founding onboard: remote image host did not resolve.");
  }
  const family = address.includes(":") ? 6 : 4;
  return new Promise<Buffer>((resolve, reject) => {
    const req = https.get(
      url,
      {
        family,
        lookup: (_host, _options, callback) => {
          callback(null, address, family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new FoundingSkippableImageError("Refusing founding onboard: remote image redirects are not allowed."));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new FoundingSkippableImageError(`Failed to download image ${url.href}: ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk as Buffer));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    req.on("error", (error) => {
      reject(new FoundingSkippableImageError(error instanceof Error ? error.message : "Image download failed."));
    });
  });
}

export function detectRasterType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  throw new Error("Refusing founding onboard: archived image is not a supported raster type.");
}

export async function loadArchiveImageBytes(input: {
  archiveDir: string;
  image: ImageArchiveRecord;
  fetchImpl?: typeof fetch;
}) {
  if (input.image.localPath) {
    const path = assertPathInsideArchive(input.archiveDir, input.image.localPath);
    const bytes = await readFile(path);
    if (input.image.checksum && fileSha256(bytes) !== input.image.checksum) {
      throw new Error("Refusing founding onboard: archived image checksum mismatch.");
    }
    const contentType = detectRasterType(bytes);
    return { bytes, contentType };
  }
  if (!input.image.originalUrl) {
    throw new Error("Refusing founding onboard: image has no local path or URL.");
  }
  const url = assertSafeRemoteUrl(input.image.originalUrl);
  const addresses = await resolvePublicRemoteAddresses(url.hostname);
  const bytes = input.fetchImpl
    ? Buffer.from(await downloadViaFetch(url, input.fetchImpl))
    : await downloadPinnedHttps(url, addresses);
  if (input.image.checksum && fileSha256(bytes) !== input.image.checksum) {
    throw new Error("Refusing founding onboard: downloaded image checksum mismatch.");
  }
  return { bytes, contentType: detectRasterType(bytes) };
}

export async function uploadFoundingImage(input: {
  config: FoundingCloudinaryConfig;
  publicId: string;
  bytes: Buffer;
  contentType: string;
  fetchImpl?: typeof fetch;
}): Promise<FoundingUploadedImage & { reused: boolean }> {
  const existing = await lookupCloudinaryResource({
    config: input.config,
    publicId: input.publicId,
    fetchImpl: input.fetchImpl,
  });
  if (existing) {
    return { ...existing, reused: true };
  }

  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    image_metadata: "false",
    overwrite: "false",
    public_id: input.publicId,
    timestamp,
    transformation: "fl_force_strip",
    type: IMAGE_CONSTRAINTS.deliveryType,
  };
  const signature = signCloudinaryParams(params, input.config.apiSecret);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.contentType }), "photo.jpg");
  form.append("api_key", input.config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("public_id", input.publicId);
  form.append("type", IMAGE_CONSTRAINTS.deliveryType);
  form.append("overwrite", "false");
  form.append("image_metadata", "false");
  form.append("transformation", "fl_force_strip");

  const response = await fetchWithRetry(
    input.fetchImpl ?? fetch,
    `https://api.cloudinary.com/v1_1/${input.config.cloudName}/image/upload`,
    { method: "POST", body: form },
    true,
  );
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
  if (!response.ok || !payload?.public_id) {
    throw new Error(payload?.error?.message ?? `Cloudinary upload failed for ${input.publicId}`);
  }
  return {
    url: payload.secure_url ?? payload.url ?? "",
    publicId: payload.public_id,
    order: 0,
    provider: "CLOUDINARY",
    assetId: payload.asset_id ?? null,
    version: payload.version != null ? String(payload.version) : null,
    width: payload.width ?? null,
    height: payload.height ?? null,
    format: payload.format ?? null,
    bytes: payload.bytes ?? null,
    reused: false,
  };
}

export async function lookupCloudinaryResource(input: {
  config: FoundingCloudinaryConfig;
  publicId: string;
  fetchImpl?: typeof fetch;
}): Promise<FoundingUploadedImage | null> {
  const encodedPublicId = encodeURIComponent(input.publicId);
  const response = await fetchWithRetry(
    input.fetchImpl ?? fetch,
    `https://api.cloudinary.com/v1_1/${input.config.cloudName}/resources/image/${IMAGE_CONSTRAINTS.deliveryType}/${encodedPublicId}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.config.apiKey}:${input.config.apiSecret}`).toString("base64")}`,
      },
    },
    true,
  );
  if (response.status === 404) return null;
  const payload = (await response.json().catch(() => null)) as {
    secure_url?: string;
    url?: string;
    asset_id?: string;
    public_id?: string;
    version?: string | number;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
  } | null;
  if (!response.ok || !payload?.public_id) return null;
  return {
    url: payload.secure_url ?? payload.url ?? "",
    publicId: payload.public_id,
    order: 0,
    provider: "CLOUDINARY",
    assetId: payload.asset_id ?? null,
    version: payload.version != null ? String(payload.version) : null,
    width: payload.width ?? null,
    height: payload.height ?? null,
    format: payload.format ?? null,
    bytes: payload.bytes ?? null,
  };
}

export async function deleteFoundingCloudinaryAssets(input: {
  config: FoundingCloudinaryConfig;
  publicIds: string[];
  fetchImpl?: typeof fetch;
}) {
  const errors: string[] = [];
  for (const publicId of input.publicIds) {
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      public_id: publicId,
      timestamp,
      type: IMAGE_CONSTRAINTS.deliveryType,
    };
    const signature = signCloudinaryParams(params, input.config.apiSecret);
    const response = await fetchWithRetry(
      input.fetchImpl ?? fetch,
      `https://api.cloudinary.com/v1_1/${input.config.cloudName}/image/destroy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          public_id: publicId,
          timestamp: String(timestamp),
          type: IMAGE_CONSTRAINTS.deliveryType,
          api_key: input.config.apiKey,
          signature,
        }).toString(),
      },
      false,
    );
    if (!response.ok) {
      errors.push(`Failed to delete Cloudinary asset ${publicId}: ${response.status}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}
