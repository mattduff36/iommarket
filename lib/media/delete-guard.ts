import {
  IMAGEKIT_DEV_PUBLIC_PREFIX,
  isDisposableDestinationPath,
  isProtectedDestinationPath,
} from "@/lib/media/config";

export interface DisposableDeleteTarget {
  fileId: string;
  filePath: string;
}

export interface DisposableAllowEntry {
  fileId: string;
  filePath: string;
}

export function assertDisposableImageKitDelete(input: {
  requested: DisposableDeleteTarget;
  observed: DisposableDeleteTarget;
  allowlist: readonly DisposableAllowEntry[];
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.requested.fileId)) {
    throw new Error("Refusing ImageKit delete: file id is invalid.");
  }
  if (input.requested.fileId !== input.observed.fileId || input.requested.filePath !== input.observed.filePath) {
    throw new Error("Refusing ImageKit delete: destination metadata does not match the request.");
  }
  if (!isDisposableDestinationPath(input.observed.filePath) || isProtectedDestinationPath(input.observed.filePath)) {
    throw new Error("Refusing ImageKit delete: path is outside the disposable development folder.");
  }
  const allowed = input.allowlist.some(
    (entry) => entry.fileId === input.observed.fileId && entry.filePath === input.observed.filePath,
  );
  if (!allowed) {
    throw new Error("Refusing ImageKit delete: file was not created by this development run.");
  }
}

export function imageKitDevPublicId(fileId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error("ImageKit file id is invalid.");
  return `${IMAGEKIT_DEV_PUBLIC_PREFIX}${fileId}`;
}

export function fileIdFromImageKitDevPublicId(publicId: string) {
  if (!publicId.startsWith(IMAGEKIT_DEV_PUBLIC_PREFIX)) return null;
  const fileId = publicId.slice(IMAGEKIT_DEV_PUBLIC_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(fileId) ? fileId : null;
}
