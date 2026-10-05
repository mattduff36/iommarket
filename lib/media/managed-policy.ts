import { isImageKitDevelopmentEnvironment, mediaDatabaseIdentity } from "@/lib/media/environment-boundary";

export type ManagedMediaScope = "production" | "staging" | "local";
export type ManagedInputFormat = "jpg" | "png" | "webp" | "heic" | "heif";
export type ManagedOutputFormat = "jpg" | "png" | "webp";
export const MANAGED_IMAGEKIT_PREFIX = "/iommarket-media/";
export const MANAGED_IMAGEKIT_PUBLIC_PREFIX = "imagekit/";
export const MANAGED_IMAGEKIT_DELIVERY_TYPE = "imagekit-managed";
const PRODUCTION_PROJECT = "snlqivvogfqesxpbjiei";
const PREVIEW_PROJECT = "syneonzucehwlghqmfbg";
const DATABASE_KEYS = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"] as const;
const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const FILE_PATH = /^\/iommarket-media\/(production|staging|local)\/(quarantine|listings)\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,80})\/(source|photo)\.(jpg|png|webp|heic|heif)$/;
const IMPORT_PREFIX = "iommarket/listings/";

export function managedMediaScope(env: NodeJS.ProcessEnv = process.env): ManagedMediaScope {
  const identities = DATABASE_KEYS.filter((key) => Boolean(env[key])).map((key) => mediaDatabaseIdentity(env[key]!));
  if (env.VERCEL_ENV === "production") {
    if (env.NEXT_PUBLIC_APP_URL !== "https://itrader.im" ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PRODUCTION_PROJECT}.supabase.co` ||
      identities.length === 0 || identities.some((identity) => identity !== PRODUCTION_PROJECT)) {
      throw new Error("Production ImageKit database and deployment identities must agree.");
    }
    return "production";
  }
  if (!isImageKitDevelopmentEnvironment(env) || identities.length === 0) {
    throw new Error("ImageKit writes require an explicitly identified application environment.");
  }
  return identities.every((identity) => identity === PREVIEW_PROJECT) ? "staging" : "local";
}

export function managedInputFormat(value: string): ManagedInputFormat {
  const normalized = value.toLowerCase() === "jpeg" ? "jpg" : value.toLowerCase();
  if (!["jpg", "png", "webp", "heic", "heif"].includes(normalized)) {
    throw new Error("Images must be JPG, PNG, WebP, HEIC, or HEIF.");
  }
  return normalized as ManagedInputFormat;
}

export function managedUploadPaths(scope: ManagedMediaScope, userId: string, intentId: string, format: ManagedInputFormat) {
  if (!["production", "staging", "local"].includes(scope) || !SEGMENT.test(userId) || !SEGMENT.test(intentId)) {
    throw new Error("ImageKit upload identity is invalid.");
  }
  const inputFormat = managedInputFormat(format);
  const outputFormat = inputFormat === "heic" || inputFormat === "heif" ? "webp" : inputFormat;
  const quarantineFolder = `${MANAGED_IMAGEKIT_PREFIX}${scope}/quarantine/${userId}/${intentId}`;
  const finalFolder = `${MANAGED_IMAGEKIT_PREFIX}${scope}/listings/${userId}/${intentId}`;
  return {
    publicId: `${MANAGED_IMAGEKIT_PUBLIC_PREFIX}${scope}/${userId}/${intentId}`,
    quarantineFolder, quarantinePath: `${quarantineFolder}/source.${inputFormat}`,
    finalFolder, finalPath: `${finalFolder}/photo.${outputFormat}`,
    inputFormat, outputFormat,
  };
}

/** Keep the full logical import namespace, used by inventory/resume and audit tools. */
export function managedImportPath(scope: ManagedMediaScope, publicId: string, format: ManagedOutputFormat) {
  const parts = publicId.startsWith(IMPORT_PREFIX) ? publicId.slice(IMPORT_PREFIX.length).split("/") : [];
  if (!["production", "staging", "local"].includes(scope) || !["jpg", "png", "webp"].includes(format) ||
    publicId.length > 850 || parts.length < 3 || !["preview-packs", "import", "repair", "founding"].includes(parts[0] ?? "") ||
    parts.some((part) => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,160}$/.test(part))) {
    throw new Error("Import media identity is outside the owned listing namespace.");
  }
  return `${MANAGED_IMAGEKIT_PREFIX}${scope}/imports/${parts.join("/")}.${format}`;
}

export function parseManagedMediaPath(filePath: string) {
  const imported = /^\/iommarket-media\/(production|staging|local)\/imports\/(.+)\.(jpg|png|webp)$/.exec(filePath);
  if (imported) {
    const scope = imported[1] as ManagedMediaScope;
    const format = imported[3] as ManagedOutputFormat;
    const publicId = IMPORT_PREFIX + imported[2];
    try { if (managedImportPath(scope, publicId, format) !== filePath) return null; }
    catch { return null; }
    return { scope, kind: "imports" as const, format, importPublicId: publicId };
  }
  const match = FILE_PATH.exec(filePath);
  if (!match) return null;
  const [, scope, kind, userId, intentId, name, format] = match;
  if ((kind === "quarantine" && name !== "source") ||
    (kind === "listings" && (name !== "photo" || format === "heic" || format === "heif"))) return null;
  return {
    scope: scope as ManagedMediaScope, kind: kind as "quarantine" | "listings",
    userId: userId!, intentId: intentId!, format: format as ManagedInputFormat,
  };
}

export function assertManagedMediaMutation(filePath: string, env: NodeJS.ProcessEnv = process.env) {
  const parsed = parseManagedMediaPath(filePath);
  if (!parsed || parsed.scope !== managedMediaScope(env)) {
    throw new Error("Refusing ImageKit mutation outside this environment's managed namespace.");
  }
  return parsed;
}

export function isManagedListingPath(filePath: string) {
  const kind = parseManagedMediaPath(filePath)?.kind;
  return kind === "listings" || kind === "imports";
}

export function managedMediaPublicId(filePath: string) {
  const parsed = parseManagedMediaPath(filePath);
  if (!parsed) throw new Error("Managed ImageKit path is invalid.");
  return parsed.kind === "imports" ? parsed.importPublicId
    : `${MANAGED_IMAGEKIT_PUBLIC_PREFIX}${parsed.scope}/${parsed.userId}/${parsed.intentId}`;
}
