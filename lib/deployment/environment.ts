import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

const STAGING_ORIGIN = "https://preview.itrader.im";
const STAGING_SUPABASE_ORIGIN = `https://${PREVIEW_PROJECT_REF}.supabase.co`;

function isPreviewDatabaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
    if (url.hostname === `db.${PREVIEW_PROJECT_REF}.supabase.co`) return true;
    return url.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(url.username) === `postgres.${PREVIEW_PROJECT_REF}`;
  } catch {
    return false;
  }
}

/** Hosted staging is an explicit deployment role tied to the preview Supabase project. */
export function isStagingDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production" || env.VERCEL_ENV !== "preview") return false;
  if (env.ITRADER_DEPLOYMENT_ROLE !== "staging") return false;
  if (env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") !== STAGING_ORIGIN) return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STAGING_SUPABASE_ORIGIN) return false;

  const urls = [env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL]
    .filter((value): value is string => Boolean(value?.trim()));
  return urls.length > 0 && urls.every(isPreviewDatabaseUrl);
}

/** Local use requires an explicit opt-in and the same preview-only data targets. */
export function isStagingOnlyFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isStagingDeployment(env)) return true;
  if (env.NODE_ENV !== "development" || env.VERCEL_ENV) return false;
  if (env.ITRADER_LOCAL_STAGING_FEATURES !== "1") return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STAGING_SUPABASE_ORIGIN) return false;
  const urls = [env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL]
    .filter((value): value is string => Boolean(value?.trim()));
  return urls.length > 0 && urls.every(isPreviewDatabaseUrl);
}
