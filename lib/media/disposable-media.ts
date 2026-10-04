import { IMAGEKIT_DISPOSABLE_PREFIX } from "@/lib/media/config";
import { appendDevManifest, readDevManifest } from "@/lib/media/dev-manifest";
import { assertDisposableImageKitDelete } from "@/lib/media/delete-guard";
import {
  deleteImageKitFile,
  getImageKitFileDetails,
  purgeImageKitUrl,
  signedImageKitDeliveryUrl,
  uploadPrivateImageKitFile,
} from "@/lib/media/imagekit-api";
import { imageKitDeliveryRelativePath } from "@/lib/media/imagekit-transforms";

export async function deleteDisposableImageKitFile(input: {
  fileId: string;
  filePath?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  allowlist?: readonly { fileId: string; filePath: string }[];
}) {
  const env = input.env ?? process.env;
  const observed = await getImageKitFileDetails({
    fileId: input.fileId,
    env,
    fetchImpl: input.fetchImpl,
  });
  if (!observed) return { deleted: false, status: "missing" as const };
  const allowlist = input.allowlist ?? readDevManifest(env);
  assertDisposableImageKitDelete({
    requested: { fileId: input.fileId, filePath: input.filePath ?? observed.filePath },
    observed: { fileId: observed.fileId, filePath: observed.filePath },
    allowlist,
  });
  const original = signedImageKitDeliveryUrl({
    relativePath: imageKitDeliveryRelativePath(observed.filePath),
    env,
  });
  await deleteImageKitFile({ fileId: observed.fileId, env, fetchImpl: input.fetchImpl });
  await purgeImageKitUrl({ url: original.split("?")[0] ?? original, env, fetchImpl: input.fetchImpl });
  return { deleted: true, status: "deleted" as const, filePath: observed.filePath };
}

export function disposableFolderForUser(userId: string, intentId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || !/^[A-Za-z0-9_-]+$/.test(intentId)) {
    throw new Error("Upload owner is invalid.");
  }
  return `${IMAGEKIT_DISPOSABLE_PREFIX}${userId}/${intentId}`;
}

export async function uploadDisposableImage(input: {
  bytes: Buffer;
  fileName: string;
  folder: string;
  purpose: "dev-upload" | "mutation-test";
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  if (!input.folder.startsWith(IMAGEKIT_DISPOSABLE_PREFIX)) {
    throw new Error("Refusing upload outside the disposable development folder.");
  }
  const uploaded = await uploadPrivateImageKitFile({
    bytes: input.bytes,
    fileName: input.fileName,
    folder: input.folder,
    env: input.env,
    fetchImpl: input.fetchImpl,
  });
  if (!uploaded.filePath.startsWith(input.folder)) {
    throw new Error("ImageKit stored the upload outside the requested folder.");
  }
  appendDevManifest(
    {
      fileId: uploaded.fileId,
      filePath: uploaded.filePath,
      purpose: input.purpose,
      createdAt: new Date().toISOString(),
    },
    input.env,
  );
  return uploaded;
}
