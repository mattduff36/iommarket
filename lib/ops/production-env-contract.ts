import { COST_LEDGER_STARTED_AT_ISO } from "@/lib/costs/config";
import type { RuntimeEnv } from "@/lib/runtime-env";
import {
  getConfiguredRippleProductUrl,
  RIPPLE_CANONICAL_PRODUCTS,
} from "@/lib/payments/ripple-config";

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
  "COST_VERCEL_TEAM_ID",
  "COST_VERCEL_PROJECT_ID",
  "COST_VERCEL_DATABASE_RESOURCE_ID",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "NEXT_PUBLIC_APP_URL",
] as const;

export const LAUNCH_SENSITIVE_KEYS = [
  "DEV_GATE_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "RIPPLE_CLIENT_ID",
  "RIPPLE_WEBHOOK_SECRET",
  "RIPPLE_REFERENCE_SECRET",
  "SUPABASE_DB_CA_CERT",
] as const;

export const PRODUCTION_SENSITIVE_KEYS = [
  "VERCEL_BILLING_TOKEN",
  "COST_SYNC_SECRET",
  "CRON_SECRET",
  ...LAUNCH_SENSITIVE_KEYS,
] as const;

export const PRODUCTION_EPHEMERAL_KEYS = ["VERCEL_OIDC_TOKEN"] as const;

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

export const PRODUCTION_FORBIDDEN_KEYS = [
  "COST_SYNC_ALLOW_NON_PROD",
  "NODE_TLS_REJECT_UNAUTHORIZED",
] as const;

export const LAUNCH_RIPPLE_URL_KEYS = [
  "RIPPLE_LISTING_PAYMENT_URL",
  "RIPPLE_FEATURED_PAYMENT_URL",
  "RIPPLE_DEALER_STARTER_URL",
  "RIPPLE_DEALER_PRO_URL",
] as const;

export const EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME = "du3othqre";

export type LaunchEnvIssueCode =
  | "missing"
  | "invalid"
  | "forbidden"
  | "legacy-stripe";

export type LaunchEnvIssue = {
  key: string;
  code: LaunchEnvIssueCode;
};

const MIN_LAUNCH_SECRET_CHARS = 32;

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function secretIsStrong(value: string | null): boolean {
  if (!value) return false;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  return value.length >= MIN_LAUNCH_SECRET_CHARS;
}

function certificateIsValid(value: string | null): boolean {
  if (!value) return false;
  const certificate = value.replace(/\\n/g, "\n");
  return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(certificate);
}

export function classifyLaunchEnvironment(env: RuntimeEnv): {
  launchState: "preview-open" | "production-live" | "gated";
  issues: LaunchEnvIssue[];
} {
  const issues: LaunchEnvIssue[] = [];
  const launchFlag = env.PRODUCTION_LAUNCH_ENABLED;
  let launchState: "preview-open" | "production-live" | "gated";
  if (env.VERCEL_ENV === "preview") {
    launchState = "preview-open";
  } else if (launchFlag === "1") {
    launchState = "production-live";
  } else if (launchFlag === undefined || launchFlag === "0") {
    launchState = "gated";
  } else {
    launchState = "gated";
    issues.push({ key: "PRODUCTION_LAUNCH_ENABLED", code: "invalid" });
  }

  if (Object.hasOwn(env, "NODE_TLS_REJECT_UNAUTHORIZED")) {
    issues.push({ key: "NODE_TLS_REJECT_UNAUTHORIZED", code: "forbidden" });
  }

  for (const key of [
    "DEV_GATE_SECRET",
    "UPSTASH_REDIS_REST_TOKEN",
    "RIPPLE_REFERENCE_SECRET",
    "RIPPLE_WEBHOOK_SECRET",
    "CLOUDINARY_API_SECRET",
  ] as const) {
    const value = present(env[key]);
    if (!value) issues.push({ key, code: "missing" });
    else if (!secretIsStrong(value)) issues.push({ key, code: "invalid" });
  }

  for (const key of ["UPSTASH_REDIS_REST_URL", "RIPPLE_CLIENT_ID", "CLOUDINARY_API_KEY"] as const) {
    if (!present(env[key])) issues.push({ key, code: "missing" });
  }

  const upstashUrl = present(env.UPSTASH_REDIS_REST_URL);
  if (upstashUrl && !upstashUrl.startsWith("https://")) {
    issues.push({ key: "UPSTASH_REDIS_REST_URL", code: "invalid" });
  }

  const certificate = present(env.SUPABASE_DB_CA_CERT);
  if (!certificate) issues.push({ key: "SUPABASE_DB_CA_CERT", code: "missing" });
  else if (!certificateIsValid(certificate)) issues.push({ key: "SUPABASE_DB_CA_CERT", code: "invalid" });

  const cloudName = present(env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
  if (!cloudName) issues.push({ key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", code: "missing" });
  else if (cloudName !== EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME) {
    issues.push({ key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", code: "invalid" });
  }

  if (env.RIPPLE_LIVE_CHECKOUT_ENABLED !== "1") {
    issues.push({ key: "RIPPLE_LIVE_CHECKOUT_ENABLED", code: "invalid" });
  }

  for (const key of LAUNCH_RIPPLE_URL_KEYS) {
    if (!present(env[key])) {
      issues.push({ key, code: "missing" });
      continue;
    }
    const product = Object.values(RIPPLE_CANONICAL_PRODUCTS).find((item) => item.envUrlKey === key);
    if (!product) continue;
    try {
      getConfiguredRippleProductUrl(product, env as NodeJS.ProcessEnv);
    } catch {
      issues.push({ key, code: "invalid" });
    }
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("STRIPE_")) issues.push({ key, code: "legacy-stripe" });
  }

  return { launchState, issues };
}

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
