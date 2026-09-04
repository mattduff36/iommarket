import {
  isAllowedPreviewDatabaseUrl,
  isAllowedPreviewSupabaseUrl,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  type PreviewWipeTargetInput,
} from "../wipe-preview-marketplace/target";

export { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF };

export const PREVIEW_SEED_KEEP_EMAILS = [
  "admin@mpdee.co.uk",
  "d.p.marshall@hotmail.co.uk",
] as const;

export function assertPreviewSeedEnvFile(seedEnvFile?: string) {
  if (!seedEnvFile) return;
  const normalized = seedEnvFile.replaceAll("\\", "/").toLowerCase();
  if (normalized.endsWith(".env.production") || normalized.includes("/.env.production")) {
    throw new Error("Refusing preview seed: do not load .env.production.");
  }
}

export function assertPreviewSeedTarget(input: PreviewWipeTargetInput) {
  if (!isAllowedPreviewSupabaseUrl(input.supabaseUrl)) {
    throw new Error(
      `Refusing preview seed: NEXT_PUBLIC_SUPABASE_URL must be https://${PREVIEW_PROJECT_REF}.supabase.co`,
    );
  }
  const dbUrls = [input.databaseUrl, input.postgresUrlNonPooling].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  if (dbUrls.length === 0) {
    throw new Error("Refusing preview seed: missing DATABASE_URL or POSTGRES_URL_NON_POOLING.");
  }
  for (const url of dbUrls) {
    if (url.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      throw new Error("Refusing preview seed: production project ref is not allowed.");
    }
    if (!isAllowedPreviewDatabaseUrl(url)) {
      throw new Error("Refusing preview seed: database URL is not the preview project.");
    }
  }
}

export function choosePreviewSeedConnectionString(input: PreviewWipeTargetInput) {
  assertPreviewSeedTarget(input);
  if (input.databaseUrl && isAllowedPreviewDatabaseUrl(input.databaseUrl)) {
    return input.databaseUrl.trim();
  }
  if (input.postgresUrlNonPooling && isAllowedPreviewDatabaseUrl(input.postgresUrlNonPooling)) {
    return input.postgresUrlNonPooling.trim();
  }
  throw new Error("Refusing preview seed: no allowed preview connection string.");
}
