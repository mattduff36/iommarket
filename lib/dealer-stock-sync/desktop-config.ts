import { readDatabaseCaCertificate } from "@/lib/db/pool-options";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { assertWorkerEnabled } from "@/lib/dealer-stock-sync/worker-guard";
import { mediaEnvironmentIssues } from "@/lib/media/environment-contract";
import { managedMediaScope } from "@/lib/media/managed-policy";
import { readMediaUploadProvider } from "@/lib/media/upload-provider";

export const DESKTOP_PAIRING_PATH = "/admin/stock-worker";
export const PAIRING_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 5;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const PREVIEW_KEYS = [
  "DEALER_STOCK_SYNC_TARGET",
  "VERCEL_ENV",
  "ITRADER_DEPLOYMENT_ROLE",
  "NODE_ENV",
  "DEALER_STOCK_SYNC_WORKER",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DB_CA_CERT",
  "MEDIA_PROVIDER",
  "NEXT_PUBLIC_MEDIA_PROVIDER",
  "MEDIA_UPLOAD_PROVIDER",
  "IMAGEKIT_UPLOADS_ENABLED",
  "IMAGEKIT_URL_ENDPOINT",
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
] as const;

const PRODUCTION_KEYS = [
  "DEALER_STOCK_SYNC_TARGET",
  "VERCEL_ENV",
  "NODE_ENV",
  "DEALER_STOCK_SYNC_WORKER",
  "DEALER_STOCK_SYNC_PRODUCTION_ENABLED",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DB_CA_CERT",
  "MEDIA_PROVIDER",
  "NEXT_PUBLIC_MEDIA_PROVIDER",
  "MEDIA_UPLOAD_PROVIDER",
  "IMAGEKIT_UPLOADS_ENABLED",
  "IMAGEKIT_URL_ENDPOINT",
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
] as const;

const ADMIN_ID = /^c[a-z0-9]{24,32}$/;
const MAX_CONFIG_CHARS = 48_000;
const MAX_VALUE_CHARS = 16_000;

export type DesktopEnvironment = "preview" | "production";

export type DesktopGateReason =
  | "disabled"
  | "allowlist"
  | "server"
  | "production_flag"
  | "origin"
  | "config"
  | "worker";

export interface DesktopGate {
  environment: DesktopEnvironment;
  origin: string;
  allowlist: readonly string[];
  configs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type DesktopGateResult =
  | { ok: true; gate: DesktopGate }
  | { ok: false; reason: DesktopGateReason };

function fail(reason: DesktopGateReason): DesktopGateResult {
  return { ok: false, reason };
}

function canonicalOrigin(environment: DesktopEnvironment, raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:") return null;
    if (environment === "preview" && url.origin === "https://itrader.dev") return url.origin;
    if (environment === "production" && (url.origin === "https://itrader.im" || url.origin === "https://www.itrader.im")) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function allowlist(raw: string | undefined): readonly string[] | null {
  if (!raw?.trim()) return null;
  const ids = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 2) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (!ids.every((id) => ADMIN_ID.test(id))) return null;
  return ids;
}

const OPTIONAL_WORKER_KEYS = new Set([
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "ITRADER_DEPLOYMENT_ROLE",
]);

function exactWorkerEnv(
  value: unknown,
  keys: readonly string[],
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const permitted = new Set<string>(keys);
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!permitted.has(key) || typeof entry !== "string" || entry.length > MAX_VALUE_CHARS || entry.includes("\0")) {
      return null;
    }
    if (!entry.trim()) {
      if (!OPTIONAL_WORKER_KEYS.has(key)) return null;
      continue;
    }
    if (key !== "SUPABASE_DB_CA_CERT" && /[\r\n]|`|\$\(/.test(entry)) return null;
    env[key] = entry;
  }
  for (const key of keys) {
    if (!OPTIONAL_WORKER_KEYS.has(key) && !env[key]) return null;
  }
  return env;
}

function workerAccepts(target: DesktopEnvironment, env: Record<string, string>): boolean {
  try {
    if (assertWorkerEnabled(env) !== target) return false;
    if (!readDatabaseCaCertificate(env)) return false;
    if (readMediaUploadProvider(env) !== "imagekit") return false;
    const mediaIssues = mediaEnvironmentIssues(env).filter((issue) =>
      issue.key.startsWith("IMAGEKIT_") || issue.key.startsWith("MEDIA_") || issue.key.startsWith("NEXT_PUBLIC_MEDIA_"),
    );
    if (mediaIssues.length > 0) return false;
    const scope = managedMediaScope(env as NodeJS.ProcessEnv);
    return scope === (target === "production" ? "production" : "staging");
  } catch {
    return false;
  }
}

function configsFor(
  raw: string | undefined,
  ids: readonly string[],
  target: DesktopEnvironment,
): Record<string, Record<string, string>> | null {
  if (!raw || raw.length > MAX_CONFIG_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  if (entries.length !== ids.length) return null;
  const keys = target === "production" ? PRODUCTION_KEYS : PREVIEW_KEYS;
  const configs: Record<string, Record<string, string>> = {};
  for (const [adminId, value] of entries) {
    if (!ids.includes(adminId)) return null;
    const env = exactWorkerEnv(value, keys);
    if (!env || env.DEALER_STOCK_SYNC_TARGET !== target || !workerAccepts(target, env)) return null;
    configs[adminId] = env;
  }
  return ids.every((id) => configs[id]) ? configs : null;
}

/** Fail closed. Worker credentials come only from the dedicated JSON map. */
export function resolveDesktopGate(env: Record<string, string | undefined>): DesktopGateResult {
  if (env.DEALER_STOCK_DESKTOP_ENABLED !== "1") return fail("disabled");
  const ids = allowlist(env.DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS);
  if (!ids) return fail("allowlist");
  const server = getDealerStockSyncAvailability(env);
  if (server.environment !== "preview" && server.environment !== "production") return fail("server");
  if (server.environment === "production" && env.DEALER_STOCK_SYNC_PRODUCTION_ENABLED !== "1") {
    return fail("production_flag");
  }
  if (!server.enabled) return fail("server");
  const origin = canonicalOrigin(server.environment, env.NEXT_PUBLIC_APP_URL);
  if (!origin) return fail("origin");
  const configs = configsFor(env.DEALER_STOCK_DESKTOP_CONFIG_JSON, ids, server.environment);
  if (!configs) return fail("config");
  return { ok: true, gate: { environment: server.environment, origin, allowlist: ids, configs } };
}

export function desktopAccountEnabled(env: Record<string, string | undefined>, adminId: string): boolean {
  const gate = resolveDesktopGate(env);
  return gate.ok && gate.gate.allowlist.includes(adminId);
}

export function browserOriginAllowed(
  origin: string | null,
  host: string | null,
  forwardedHost: string | null,
  canonical: string,
): boolean {
  if (!origin || !host) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== canonical || parsed.username || parsed.password) return false;
  const expectedHost = new URL(canonical).host;
  const forwarded = forwardedHost?.split(",")[0]?.trim();
  const publicHost = forwarded || host.split(",")[0]?.trim();
  return publicHost === expectedHost;
}
