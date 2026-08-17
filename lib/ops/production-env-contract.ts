import { COST_LEDGER_STARTED_AT_ISO } from "@/lib/costs/config";

export const PRODUCTION_ENV_MIRROR_FILE = ".env.production";
export const PRODUCTION_ENV_LOCK_FILE = ".env.production.lock";
export const PRODUCTION_ENV_STAGING_PREFIX = ".env.production.staging-";
export const PRODUCTION_VERCEL_PROJECT_ID = "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr";
export const PRODUCTION_VERCEL_TEAM_ID = "team_nNF8inhmRhFvWkaLOl2cwdE6";

export const PRODUCTION_REQUIRED_KEYS = [
  "COSTS_ENABLED",
  "COST_LEDGER_STARTED_AT",
  "COST_OWNER_AUTH_USER_ID",
  "COST_OWNER_NOTIFICATION_EMAIL",
  "VERCEL_BILLING_TOKEN",
  "COST_VERCEL_TEAM_ID",
  "COST_VERCEL_PROJECT_ID",
  "COST_VERCEL_DATABASE_RESOURCE_ID",
  "COST_SYNC_SECRET",
  "CRON_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "NEXT_PUBLIC_APP_URL",
] as const;

export const PRODUCTION_EXACT_VALUES: Record<string, string> = {
  COST_LEDGER_STARTED_AT: COST_LEDGER_STARTED_AT_ISO,
  COST_VERCEL_TEAM_ID: PRODUCTION_VERCEL_TEAM_ID,
  COST_VERCEL_PROJECT_ID: PRODUCTION_VERCEL_PROJECT_ID,
};

export const PRODUCTION_BOOLEAN_KEYS = ["COSTS_ENABLED"] as const;

export const PRODUCTION_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "NEXT_PUBLIC_APP_URL",
] as const;

export const PRODUCTION_FORBIDDEN_KEYS = ["COST_SYNC_ALLOW_NON_PROD"] as const;

const PLACEHOLDER_VALUES = new Set([
  "",
  "replace-with-cost-sync-secret",
  "replace-with-cron-secret",
  "supabase-auth-user-id",
  "owner@example.com",
  "store_or_resource_id",
  "team_...",
  "prj_...",
]);

export function isPlaceholderEnvValue(value: string): boolean {
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUES.has(trimmed)) return true;
  return /replace-with-|your-[a-z-]+|example\.com/i.test(trimmed);
}
