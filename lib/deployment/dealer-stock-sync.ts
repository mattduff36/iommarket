type Environment = "preview" | "production" | "local";
type Env = Record<string, string | undefined>;

const PROJECTS = {
  preview: "syneonzucehwlghqmfbg",
  production: "snlqivvogfqesxpbjiei",
} as const;

export const DEALER_SYNC_PRODUCTION_DISABLED =
  "Website stock sync is disabled in production until it has been verified in preview.";

export interface DealerStockSyncAvailability {
  enabled: boolean;
  environment: Environment | null;
  reason: string | null;
}

function appEnvironment(raw: string | undefined): Environment | null {
  try {
    const url = new URL(raw ?? "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.origin === "https://itrader.dev") return "preview";
    if (["https://itrader.im", "https://www.itrader.im"].includes(url.origin)) return "production";
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "local";
  } catch { /* Invalid configuration fails closed. */ }
  return null;
}

function databaseMatches(raw: string, environment: Environment): boolean {
  try {
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    if (environment === "local") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.port && !["5432", "6543"].includes(url.port)) return false;
    const ref = PROJECTS[environment];
    return url.hostname === `db.${ref}.supabase.co` ||
      (url.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(url.username) === `postgres.${ref}`);
  } catch {
    return false;
  }
}

/** Validate every configured connection, not just the URL preferred by Prisma. */
export function getDealerStockSyncAvailability(env: Env = process.env): DealerStockSyncAvailability {
  const app = appEnvironment(env.NEXT_PUBLIC_APP_URL);
  const hosted = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview" : null;
  const target = env.DEALER_STOCK_SYNC_TARGET;
  const explicit = target === "preview" || target === "production" || target === "local" ? target : null;
  const environment = hosted ?? app ?? explicit;
  const deny = (reason: string): DealerStockSyncAvailability => ({ enabled: false, environment, reason });
  if (!environment) return deny("Website stock sync is unavailable because its environment could not be verified.");
  if (environment === "production" && env.DEALER_STOCK_SYNC_PRODUCTION_ENABLED !== "1") {
    return deny(DEALER_SYNC_PRODUCTION_DISABLED);
  }
  if (env.DEALER_STOCK_SYNC_ENABLED === "0") return deny("Website stock sync has been disabled for this environment.");
  if ((hosted && app !== hosted) || (explicit && explicit !== environment)) {
    return deny("Website stock sync is blocked because the site and database environment settings do not agree.");
  }
  if (environment === "local") {
    if (env.DEALER_STOCK_SYNC_ISOLATED_LOCAL !== "1" || env.NODE_ENV === "production" || env.VERCEL_ENV) {
      return deny("Local stock sync requires an explicitly isolated local database.");
    }
  } else {
    const expectedAuth = `https://${PROJECTS[environment]}.supabase.co`;
    if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== expectedAuth) {
      return deny("Website stock sync is blocked because the authentication environment does not match the site.");
    }
  }
  const urls = [env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  if (!urls.length || !urls.every((url) => databaseMatches(url, environment))) {
    return deny("Website stock sync is blocked because the database does not match this environment.");
  }
  return { enabled: true, environment, reason: null };
}

export function assertDealerStockSyncEnvironment(env: Env = process.env) {
  const availability = getDealerStockSyncAvailability(env);
  if (!availability.enabled) throw new Error(availability.reason ?? "Website stock sync is disabled.");
  return availability.environment;
}
