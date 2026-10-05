import { createHash } from "node:crypto";
import { IMAGE_CONSTRAINTS, validateListingImageBounds } from "@/lib/images/constraints";
import { assertManagedMediaMutation, parseManagedMediaPath } from "@/lib/media/managed-policy";
import { deleteImageKitFile, getImageKitFileDetails, purgeImageKitUrl, signedImageKitDeliveryUrl, type ImageKitFileDetails } from "@/lib/media/imagekit-api";
import { imageKitDeliveryRelativePath } from "@/lib/media/imagekit-transforms";

interface Options { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }
interface Target { fileId: string; filePath: string }
const FILE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MANAGEMENT_URL = "https://api.imagekit.io/v1/files";
const REQUEST_TIMEOUT = 30_000;

function credentials(env: NodeJS.ProcessEnv) {
  if (env.IMAGEKIT_URL_ENDPOINT !== "https://ik.imagekit.io/itraderim" || !env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("ImageKit is not configured for the verified account.");
  }
  return { Authorization: `Basic ${Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}` };
}

export async function requireManagedFileDetails(input: Target & Options) {
  if (!FILE_ID.test(input.fileId) || !parseManagedMediaPath(input.filePath)) throw new Error("Managed file identity is invalid.");
  const env = input.env ?? process.env;
  credentials(env);
  const observed = await getImageKitFileDetails(input);
  if (!observed || observed.fileId !== input.fileId || observed.filePath !== input.filePath) {
    throw new Error("ImageKit file identity does not match the upload intent.");
  }
  if (observed.isPrivateFile !== true || observed.fileType !== "image") throw new Error("The upload must be a private image.");
  const boundsError = validateListingImageBounds({ width: observed.width, height: observed.height, bytes: observed.size });
  if (boundsError) throw new Error(boundsError);
  return observed;
}

export async function findManagedFileByPath(input: { filePath: string } & Options): Promise<ImageKitFileDetails | null> {
  const parsed = parseManagedMediaPath(input.filePath);
  if (!parsed) throw new Error("Managed file path is invalid.");
  const env = input.env ?? process.env;
  const slash = input.filePath.lastIndexOf("/");
  const query = new URLSearchParams({
    path: input.filePath.slice(0, slash),
    searchQuery: `name="${input.filePath.slice(slash + 1)}"`,
    limit: "100",
  });
  const response = await (input.fetchImpl ?? fetch)(`${MANAGEMENT_URL}?${query}`, {
    headers: credentials(env), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new Error(`ImageKit file lookup failed (${response.status}).`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length >= 100) throw new Error("ImageKit file lookup is incomplete.");
  const matches = rows.filter((row) => row && row.filePath === input.filePath && FILE_ID.test(row.fileId ?? ""));
  if (matches.length > 1) throw new Error("ImageKit file lookup is ambiguous.");
  if (!matches[0]) return null;
  return getImageKitFileDetails({ fileId: matches[0].fileId, env, fetchImpl: input.fetchImpl });
}

export async function downloadManagedImageKitBytes(input: {
  filePath: string;
  convertHeif?: boolean;
  maxBytes?: number;
} & Options) {
  const parsed = parseManagedMediaPath(input.filePath);
  if (!parsed) throw new Error("Managed file path is invalid.");
  if (input.convertHeif && !["heic", "heif"].includes(parsed.format)) throw new Error("Unexpected image conversion.");
  const env = input.env ?? process.env;
  credentials(env);
  const maxBytes = Math.min(input.maxBytes ?? IMAGE_CONSTRAINTS.maxFileSizeBytes, IMAGE_CONSTRAINTS.maxFileSizeBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("ImageKit response size limit is invalid.");
  const url = signedImageKitDeliveryUrl({
    relativePath: imageKitDeliveryRelativePath(input.filePath, input.convertHeif ? "f-webp,q-95" : "orig-true"), env,
  });
  const response = await (input.fetchImpl ?? fetch)(url, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT), headers: { Accept: "*/*" },
  });
  if (!response.ok || !response.body) throw new Error(`ImageKit download failed (${response.status}).`);
  if (response.headers.get("is-intermediate-response") === "true") throw new Error("Image conversion is still processing. Retry verification shortly.");
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body.cancel();
    throw new Error("ImageKit response exceeds the allowed file size.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("ImageKit response exceeds the allowed file size.");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new Error("ImageKit returned an empty file.");
  return Buffer.concat(chunks, length);
}

export async function uploadImmutableManagedImage(input: { filePath: string; bytes: Buffer } & Options) {
  const env = input.env ?? process.env;
  const parsed = assertManagedMediaMutation(input.filePath, env);
  if (parsed.kind !== "listings" && parsed.kind !== "imports") throw new Error("Sanitized images must use the managed listing namespace.");
  if (!input.bytes.length || input.bytes.length > IMAGE_CONSTRAINTS.maxFileSizeBytes) throw new Error("Image file size is invalid.");
  const fetchImpl = input.fetchImpl ?? fetch;
  let observed = await findManagedFileByPath(input);
  if (!observed) {
    const slash = input.filePath.lastIndexOf("/");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(input.bytes)]), input.filePath.slice(slash + 1));
    form.set("fileName", input.filePath.slice(slash + 1));
    form.set("folder", input.filePath.slice(0, slash));
    form.set("useUniqueFileName", "false");
    form.set("overwriteFile", "false");
    form.set("isPrivateFile", "true");
    form.set("responseFields", "isPrivateFile");
    let status = 0;
    try {
      const response = await fetchImpl("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST", headers: credentials(env), body: form, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      status = response.status;
      if (response.ok) {
        const payload = await response.json() as Partial<ImageKitFileDetails>;
        if (payload.fileId && payload.filePath === input.filePath) {
          observed = await getImageKitFileDetails({ fileId: payload.fileId, env, fetchImpl });
        }
      }
    } catch {
      // A lost response does not mean a write failed. Recover only the exact immutable path.
    }
    observed ??= await findManagedFileByPath(input);
    if (!observed) throw new Error(`ImageKit upload did not produce the expected file (${status || "network"}).`);
  }
  await requireManagedFileDetails({ fileId: observed.fileId, filePath: input.filePath, env, fetchImpl });
  const stored = await downloadManagedImageKitBytes({ filePath: input.filePath, env, fetchImpl });
  const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  if (sha(stored) !== sha(input.bytes)) throw new Error("The immutable ImageKit file does not match the sanitized upload.");
  return observed;
}

export async function deleteManagedImageKitFile(input: Target & Options & { allowlist: readonly Target[] }) {
  const env = input.env ?? process.env;
  assertManagedMediaMutation(input.filePath, env);
  if (!FILE_ID.test(input.fileId) || !input.allowlist.some((item) => item.fileId === input.fileId && item.filePath === input.filePath)) {
    throw new Error("Managed ImageKit deletion requires an exact ownership allowlist.");
  }
  const observed = await getImageKitFileDetails(input);
  if (observed && (observed.fileId !== input.fileId || observed.filePath !== input.filePath)) {
    throw new Error("ImageKit delete refused: observed identity changed.");
  }
  if (observed) await deleteImageKitFile(input);
  // Repeat the purge after a lost delete response as well. Signed variants retain the configured TTL contract.
  const original = signedImageKitDeliveryUrl({ relativePath: imageKitDeliveryRelativePath(input.filePath), env });
  await purgeImageKitUrl({ url: original.split("?")[0]!, env, fetchImpl: input.fetchImpl });
  return { deleted: Boolean(observed), status: observed ? "deleted" as const : "missing" as const };
}
