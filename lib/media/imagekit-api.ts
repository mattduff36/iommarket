import { imageKitSignatureTtlSeconds } from "@/lib/media/config";
import { parseImageKitEndpoint, signImageKitRelativePath } from "@/lib/media/imagekit-sign";
import { isStagingTestRuntime } from "@/lib/deployment/staging-test-runtime";
import { assertManagedMediaMutation } from "@/lib/media/managed-policy";

function assertStagingStoragePath(filePath: string, env: NodeJS.ProcessEnv) {
  if (/^\/iommarket-dev-disposable\/[A-Za-z0-9_./-]+$/.test(filePath) &&
    !filePath.includes("..") && !filePath.includes("//")) return;
  assertManagedMediaMutation(filePath, env);
}

function imageKitConfig(env: NodeJS.ProcessEnv = process.env) {
  const privateKey = env.IMAGEKIT_PRIVATE_KEY ?? "";
  const endpoint = env.IMAGEKIT_URL_ENDPOINT ?? "";
  if (!privateKey || !endpoint) throw new Error("ImageKit is not configured.");
  return { privateKey, endpoint: parseImageKitEndpoint(endpoint).href };
}

function authorizationHeader(privateKey: string) {
  return `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;
}

async function imageKitJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? `ImageKit request failed: ${response.status}`);
  }
  return payload;
}

export interface ImageKitFileDetails {
  fileId: string;
  filePath: string;
  size: number;
  width: number;
  height: number;
  fileType: string;
  isPrivateFile: boolean;
}

export async function uploadPrivateImageKitFile(input: {
  bytes: Buffer;
  fileName: string;
  folder: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = input.env ?? process.env;
  const config = imageKitConfig(env);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(input.bytes)]), input.fileName);
  form.set("fileName", input.fileName);
  form.set("folder", input.folder);
  form.set("useUniqueFileName", "true");
  form.set("isPrivateFile", "true");
  const response = await (input.fetchImpl ?? fetch)("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: authorizationHeader(config.privateKey) },
    body: form,
  });
  const payload = (await response.json().catch(() => null)) as (ImageKitFileDetails & { message?: string }) | null;
  if (!response.ok || !payload?.fileId || !payload.filePath) {
    throw new Error(payload?.message ?? "ImageKit upload failed.");
  }
  if (!payload.filePath.startsWith(input.folder)) {
    if (payload.filePath.startsWith("/iommarket-dev-disposable/")) {
      await deleteImageKitFile({ fileId: payload.fileId, env, fetchImpl: input.fetchImpl }).catch(() => undefined);
    }
    throw new Error("ImageKit stored the upload outside the requested folder.");
  }
  const details = payload.isPrivateFile === true
    ? payload
    : await getImageKitFileDetails({ fileId: payload.fileId, env, fetchImpl: input.fetchImpl });
  if (!details || details.fileId !== payload.fileId || details.filePath !== payload.filePath || details.isPrivateFile !== true) {
    if (payload.filePath.startsWith("/iommarket-dev-disposable/")) {
      await deleteImageKitFile({ fileId: payload.fileId, env, fetchImpl: input.fetchImpl }).catch(() => undefined);
    }
    throw new Error("ImageKit upload did not stay private.");
  }
  return { ...payload, ...details, isPrivateFile: true as const };
}

export async function getImageKitFileDetails(input: {
  fileId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ImageKitFileDetails | null> {
  const env = input.env ?? process.env;
  const config = imageKitConfig(env);
  const response = await (input.fetchImpl ?? fetch)(
    `https://api.imagekit.io/v1/files/${encodeURIComponent(input.fileId)}/details`,
    { headers: { Authorization: authorizationHeader(config.privateKey) }, cache: "no-store" },
  );
  if (response.status === 404) return null;
  const payload = (await imageKitJson(response)) as unknown as ImageKitFileDetails;
  if (!payload?.fileId || !payload.filePath) throw new Error("ImageKit file details were incomplete.");
  return payload;
}

export async function deleteImageKitFile(input: {
  fileId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = input.env ?? process.env;
  const staging = isStagingTestRuntime(env);
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({ mediaIds: [input.fileId] });
  if (staging) {
    const observed = await getImageKitFileDetails(input);
    if (!observed) return;
    if (observed.fileId !== input.fileId) throw new Error("ImageKit delete identity does not match.");
    assertStagingStoragePath(observed.filePath, env);
  }
  const config = imageKitConfig(env);
  const response = await (input.fetchImpl ?? fetch)(
    `https://api.imagekit.io/v1/files/${encodeURIComponent(input.fileId)}`,
    { method: "DELETE", headers: { Authorization: authorizationHeader(config.privateKey) } },
  );
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`ImageKit delete failed: ${response.status}`);
  }
}

export async function purgeImageKitUrl(input: {
  url: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = input.env ?? process.env;
  const staging = isStagingTestRuntime(env);
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({ mediaIds: [input.url] });
  const config = imageKitConfig(env);
  const endpoint = parseImageKitEndpoint(env.IMAGEKIT_URL_ENDPOINT);
  const target = new URL(input.url);
  if (target.origin !== endpoint.origin || !target.pathname.startsWith(`${endpoint.basePath}/`)) {
    throw new Error("Refusing to purge a URL outside the ImageKit endpoint.");
  }
  if (staging) {
    const relative = target.pathname.slice(endpoint.basePath.length).replace(/^\/tr:[^/]+\//, "/");
    assertStagingStoragePath(relative, env);
  }
  const response = await (input.fetchImpl ?? fetch)("https://api.imagekit.io/v1/files/purge", {
    method: "POST",
    headers: {
      Authorization: authorizationHeader(config.privateKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: input.url }),
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`ImageKit purge failed: ${response.status}`);
  }
}

export function signedImageKitDeliveryUrl(input: {
  relativePath: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
}) {
  const env = input.env ?? process.env;
  const config = imageKitConfig(env);
  const expiresAt = Math.floor((input.now ?? Date.now()) / 1000) + imageKitSignatureTtlSeconds(env);
  return signImageKitRelativePath({
    endpoint: config.endpoint,
    privateKey: config.privateKey,
    relativePath: input.relativePath,
    expiresAt,
  });
}
