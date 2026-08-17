import { timingSafeEqual } from "node:crypto";
import { COST_POLICY_VERSION } from "@/lib/costs/money";

export const COST_LEDGER_CONFIG_ID = "default";
export const COST_OPEN_REQUEST_SLOT = "OPEN";
export const COST_SYNC_LOCK_KEY = 727401;
export const COST_FX_PAIR_USD_GBP = "USDGBP";
export const COST_FX_PROVIDER = "frankfurter";
export const COST_IDENTITY_FX_PROVIDER = "identity";

export class CostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostConfigError";
  }
}

export function isCostsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COSTS_ENABLED === "true";
}

export function isCostSyncNonProdAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COST_SYNC_ALLOW_NON_PROD === "1";
}

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export function getCostOwnerAuthUserId(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.COST_OWNER_AUTH_USER_ID?.trim();
  if (!value) {
    throw new CostConfigError("COST_OWNER_AUTH_USER_ID is not configured.");
  }
  return value;
}

export function getCostOwnerNotificationEmail(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.COST_OWNER_NOTIFICATION_EMAIL?.trim();
  if (!value) {
    throw new CostConfigError("COST_OWNER_NOTIFICATION_EMAIL is not configured.");
  }
  return value;
}

export function getCostLedgerStartedAt(env: NodeJS.ProcessEnv = process.env): Date {
  const value = env.COST_LEDGER_STARTED_AT?.trim();
  if (!value) {
    throw new CostConfigError("COST_LEDGER_STARTED_AT is not configured.");
  }
  const startedAt = new Date(value);
  if (Number.isNaN(startedAt.getTime())) {
    throw new CostConfigError("COST_LEDGER_STARTED_AT must be an ISO timestamp.");
  }
  return startedAt;
}

export function getVercelBillingConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = env.VERCEL_BILLING_TOKEN?.trim();
  const teamId = env.COST_VERCEL_TEAM_ID?.trim();
  const projectId = env.COST_VERCEL_PROJECT_ID?.trim();
  const databaseResourceId = env.COST_VERCEL_DATABASE_RESOURCE_ID?.trim();
  if (!token || !teamId || !projectId || !databaseResourceId) {
    throw new CostConfigError("Vercel billing identifiers are not fully configured.");
  }
  return { token, teamId, projectId, databaseResourceId };
}

export function getCostPolicyVersion(): string {
  return COST_POLICY_VERSION;
}

export function isCostOwner(authUserId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return authUserId === getCostOwnerAuthUserId(env);
  } catch {
    return false;
  }
}

export function isBearerSecretAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authorizationHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorizationHeader);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
