export const MEDIA_PROVIDER_MODES = ["cloudinary", "imagekit-sample", "imagekit"] as const;

export type MediaProviderMode = (typeof MEDIA_PROVIDER_MODES)[number];

export const IMAGEKIT_DISPOSABLE_PREFIX = "/iommarket-dev-disposable/";
export const IMAGEKIT_MIGRATION_PREFIX = "/iommarket-migration/";
export const IMAGEKIT_SAMPLE_PREFIX = "/iommarket-migration-sample/";
export const IMAGEKIT_DEV_PUBLIC_PREFIX = "imagekit-dev/";
export const IMAGEKIT_PRIVATE_URL_PREFIX = "imagekit-private:";
export const DEFAULT_IMAGEKIT_SIGNATURE_TTL_SECONDS = 300;

const PROTECTED_DESTINATION_PREFIXES = [
  IMAGEKIT_MIGRATION_PREFIX,
  IMAGEKIT_SAMPLE_PREFIX,
] as const;

export function readMediaProviderMode(env: Record<string, string | undefined> = process.env): MediaProviderMode {
  const requested = env.MEDIA_PROVIDER?.trim();
  if (requested === "imagekit" || requested === "imagekit-sample") return requested;
  return "cloudinary";
}

export function imageKitModeIsStrict(
  mode: MediaProviderMode,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (mode === "cloudinary") return false;
  if (mode === "imagekit") return true;
  return env.MEDIA_IMAGEKIT_STRICT === "1";
}

export function imageKitDevUploadsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.IMAGEKIT_DEV_UPLOADS === "1" && readMediaProviderMode(env) === "imagekit";
}

export function imageKitSignatureTtlSeconds(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number(env.IMAGEKIT_SIGNATURE_TTL_SECONDS ?? DEFAULT_IMAGEKIT_SIGNATURE_TTL_SECONDS);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3600) {
    return DEFAULT_IMAGEKIT_SIGNATURE_TTL_SECONDS;
  }
  return parsed;
}

export function isSampleDestinationPath(filePath: string) {
  return filePath.startsWith(IMAGEKIT_SAMPLE_PREFIX);
}

export function isMigratedDestinationPath(filePath: string) {
  return filePath.startsWith(IMAGEKIT_MIGRATION_PREFIX) || isSampleDestinationPath(filePath);
}

export function isProtectedDestinationPath(filePath: string) {
  return PROTECTED_DESTINATION_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function isDisposableDestinationPath(filePath: string) {
  return filePath.startsWith(IMAGEKIT_DISPOSABLE_PREFIX);
}
