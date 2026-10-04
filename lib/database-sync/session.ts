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

function isPoolerUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.endsWith(".pooler.supabase.com");
  } catch {
    return false;
  }
}

function derivePreviewSessionPoolerUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const user = decodeURIComponent(url.username);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      !url.hostname.endsWith(".pooler.supabase.com") ||
      user !== `postgres.${PREVIEW_PROJECT_REF}` ||
      url.port !== "6543") return null;
    url.port = "5432";
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return null;
  }
}

export function resolvePreviewSessionUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_SYNC_SESSION_URL) {
    if (isPreviewSessionUrl(env.DATABASE_SYNC_SESSION_URL)) return env.DATABASE_SYNC_SESSION_URL;
    throw new DatabaseSyncError("DATABASE_SYNC_SESSION_URL must be a preview session connection.");
  }
  const candidates = [env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL, env.POSTGRES_URL]
    .filter((candidate): candidate is string => Boolean(candidate));
  const existingPooler = candidates.find((candidate) => isPreviewSessionUrl(candidate) && isPoolerUrl(candidate));
  if (existingPooler) return existingPooler;
  for (const candidate of candidates) {
    const derived = derivePreviewSessionPoolerUrl(candidate);
    if (derived) return derived;
  }
  const direct = candidates.find(isPreviewSessionUrl);
  if (direct) return direct;
  throw new DatabaseSyncError("A preview session connection is required. Transaction-pooler connections cannot apply or restore a clone.");
}
