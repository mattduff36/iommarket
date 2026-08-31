import { redactDatabaseTarget } from "../../prisma/seed/target";
import {
  PREVIEW_DB_HOST,
  PREVIEW_POOLER_USER,
  PREVIEW_PROJECT_REF,
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_DB_HOST,
  PRODUCTION_POOLER_USER,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_SUPABASE_HOST,
} from "./constants";

export type MirrorRef = typeof PREVIEW_PROJECT_REF | typeof PRODUCTION_PROJECT_REF;

export interface MirrorUrlInput {
  previewDatabaseUrl?: string;
  productionDatabaseUrl?: string;
  previewSupabaseUrl?: string;
  productionSupabaseUrl?: string;
}

function parseUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function containsRef(value: string, ref: string) {
  return value.toLowerCase().includes(ref.toLowerCase());
}

function isPoolerHost(hostname: string) {
  return hostname.toLowerCase().endsWith(".pooler.supabase.com");
}

function poolerUserFor(ref: string) {
  return `postgres.${ref}`.toLowerCase();
}

function isDirectDbHost(hostname: string, ref: string) {
  return hostname.toLowerCase() === `db.${ref}.supabase.co`;
}

export function assertSourceAndDestRefs(sourceRef: string, destRef: string) {
  if (sourceRef === destRef) {
    throw new Error("Refusing mirror: SOURCE_REF and DEST_REF must not be equal.");
  }
  if (sourceRef !== PREVIEW_PROJECT_REF) {
    throw new Error(`Refusing mirror: SOURCE_REF must be ${PREVIEW_PROJECT_REF}.`);
  }
  if (destRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing mirror: DEST_REF must be ${PRODUCTION_PROJECT_REF}.`);
  }
}

export function isAllowedPreviewDatabaseUrl(connectionString: string | undefined, allowPooler: boolean) {
  const parsed = parseUrl(connectionString);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  if (isLoopbackHost(host)) return false;
  if (containsRef(host, PRODUCTION_PROJECT_REF) || containsRef(user, PRODUCTION_PROJECT_REF)) {
    return false;
  }
  if (isDirectDbHost(host, PREVIEW_PROJECT_REF)) return true;
  if (allowPooler && isPoolerHost(host) && user === poolerUserFor(PREVIEW_PROJECT_REF)) {
    return true;
  }
  return false;
}

export function isAllowedProductionDatabaseUrl(
  connectionString: string | undefined,
  allowPooler: boolean,
) {
  const parsed = parseUrl(connectionString);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  if (isLoopbackHost(host)) return false;
  if (containsRef(host, PREVIEW_PROJECT_REF) || containsRef(user, PREVIEW_PROJECT_REF)) {
    return false;
  }
  if (isDirectDbHost(host, PRODUCTION_PROJECT_REF)) return true;
  if (allowPooler && isPoolerHost(host) && user === poolerUserFor(PRODUCTION_PROJECT_REF)) {
    return true;
  }
  return false;
}

export function isAllowedRestoreDatabaseUrl(connectionString: string | undefined) {
  return isAllowedProductionDatabaseUrl(connectionString, false);
}

export function isAllowedWaitlistWriteDatabaseUrl(connectionString: string | undefined) {
  return isAllowedPreviewDatabaseUrl(connectionString, true);
}

export function isAllowedSupabaseApiUrl(raw: string | undefined, ref: MirrorRef) {
  const parsed = parseUrl(raw);
  if (!parsed) return false;
  if (parsed.protocol !== "https:") return false;
  const expected = ref === PREVIEW_PROJECT_REF ? PREVIEW_SUPABASE_HOST : PRODUCTION_SUPABASE_HOST;
  if (parsed.hostname.toLowerCase() !== expected) return false;
  if (parsed.port && parsed.port !== "443") return false;
  if (parsed.username || parsed.password) return false;
  const other = ref === PREVIEW_PROJECT_REF ? PRODUCTION_PROJECT_REF : PREVIEW_PROJECT_REF;
  if (containsRef(parsed.hostname, other)) return false;
  return true;
}

export function chooseDirectConnectionString(
  urls: Array<string | undefined>,
  kind: "preview" | "production",
) {
  const allow = kind === "preview" ? isAllowedPreviewDatabaseUrl : isAllowedProductionDatabaseUrl;
  for (const url of urls) {
    if (!url?.trim()) continue;
    const parsed = parseUrl(url);
    if (!parsed) continue;
    const host = parsed.hostname.toLowerCase();
    const expected = kind === "preview" ? PREVIEW_DB_HOST : PRODUCTION_DB_HOST;
    if (host === expected && allow(url, false)) return url.trim();
  }
  for (const url of urls) {
    if (url?.trim() && allow(url, true)) return url.trim();
  }
  throw new Error(`Refusing mirror: no allowed ${kind} connection string.`);
}

export function chooseRestoreConnectionString(urls: Array<string | undefined>) {
  for (const url of urls) {
    if (isAllowedRestoreDatabaseUrl(url)) return url!.trim();
  }
  throw new Error("Refusing restore: production direct (non-pooling) database URL required.");
}

export function chooseWaitlistWriteConnectionString(urls: Array<string | undefined>) {
  return chooseDirectConnectionString(urls, "preview");
}

export function redactedConfirmDb(connectionString: string | undefined) {
  const redacted = redactDatabaseTarget(connectionString);
  if (!redacted) {
    throw new Error("Refusing mirror: CONFIRM_DB target could not be parsed.");
  }
  return redacted;
}

export function assertRestoreNotPooler(connectionString: string) {
  const parsed = parseUrl(connectionString);
  if (!parsed) {
    throw new Error("Refusing restore: invalid database URL.");
  }
  if (isPoolerHost(parsed.hostname)) {
    throw new Error("Refusing restore: pooler URLs are not allowed.");
  }
  if (!isDirectDbHost(parsed.hostname, PRODUCTION_PROJECT_REF)) {
    throw new Error("Refusing restore: database URL is not production direct.");
  }
}

export const MIRROR_HOSTS = {
  previewDb: PREVIEW_DB_HOST,
  previewPoolerUser: PREVIEW_POOLER_USER,
  productionDb: PRODUCTION_DB_HOST,
  productionPoolerUser: PRODUCTION_POOLER_USER,
  previewSupabase: PREVIEW_SUPABASE_HOST,
  productionSupabase: PRODUCTION_SUPABASE_HOST,
};
