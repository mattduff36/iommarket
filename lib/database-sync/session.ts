import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { DatabaseSyncError } from "./snapshot";

export function isTransactionPoolerUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.port === "6543" || url.searchParams.get("pgbouncer") === "true";
  } catch {
    return true;
  }
}

export function isPreviewSessionUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || isTransactionPoolerUrl(raw)) return false;
    const user = decodeURIComponent(url.username);
    if (url.hostname === `db.${PREVIEW_PROJECT_REF}.supabase.co`) return true;
    return url.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${PREVIEW_PROJECT_REF}` && (url.port === "" || url.port === "5432");
  } catch {
    return false;
  }
}

export function resolvePreviewSessionUrl(env: NodeJS.ProcessEnv): string {
  for (const candidate of [env.DATABASE_SYNC_SESSION_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL, env.POSTGRES_URL]) {
    if (candidate && isPreviewSessionUrl(candidate)) return candidate;
  }
  throw new DatabaseSyncError("A preview session connection is required. Transaction-pooler connections cannot apply or restore a clone.");
}
