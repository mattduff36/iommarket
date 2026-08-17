import { timingSafeEqual } from "node:crypto";
import { COST_POLICY_VERSION } from "@/lib/costs/money";

export const COST_LEDGER_CONFIG_ID = "default";
export const COST_OPEN_REQUEST_SLOT = "OPEN";
export const COST_SYNC_LOCK_KEY = 727401;
export const COST_FX_PAIR_USD_GBP = "USDGBP";
export const COST_FX_PROVIDER = "frankfurter";
export const COST_IDENTITY_FX_PROVIDER = "identity";
export const COST_LEDGER_STARTED_AT_ISO = "2026-08-13T23:00:00.000Z";
export const COST_LEDGER_PREVIOUS_STARTED_AT_NAIVE = "2026-09-01 07:00:00";
const STRICT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

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
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "production";
  }
  return env.NODE_ENV === "production";
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

export function parseCostLedgerStartedAt(value: string): Date {
  const trimmed = value.trim();
  const match = trimmed.match(STRICT_ISO_TIMESTAMP);
  if (!match) {
    throw new CostConfigError(
      "COST_LEDGER_STARTED_AT must be a timezone-bearing ISO timestamp.",
    );
  }
  const startedAt = new Date(trimmed);
  if (Number.isNaN(startedAt.getTime())) {
    throw new CostConfigError("COST_LEDGER_STARTED_AT must be a valid ISO timestamp.");
  }
  const millisecond = (match[7] ?? "0").padEnd(3, "0");
  if (
    startedAt.getUTCFullYear() !== Number(match[1]) ||
    startedAt.getUTCMonth() + 1 !== Number(match[2]) ||
    startedAt.getUTCDate() !== Number(match[3]) ||
    startedAt.getUTCHours() !== Number(match[4]) ||
    startedAt.getUTCMinutes() !== Number(match[5]) ||
    startedAt.getUTCSeconds() !== Number(match[6]) ||
    startedAt.getUTCMilliseconds() !== Number(millisecond)
  ) {
    throw new CostConfigError("COST_LEDGER_STARTED_AT must be a real calendar timestamp.");
  }
  return startedAt;
}

export function getCostLedgerStartedAt(env: NodeJS.ProcessEnv = process.env): Date {
  const value = env.COST_LEDGER_STARTED_AT?.trim();
  if (!value) {
    throw new CostConfigError("COST_LEDGER_STARTED_AT is not configured.");
  }
  return parseCostLedgerStartedAt(value);
}

export function assertLedgerConfigMatchesEnvironment(input: {
  startedAt: Date;
  policyVersion: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const expectedStartedAt = getCostLedgerStartedAt(input.env);
  const expectedPolicy = getCostPolicyVersion();
  if (
    input.startedAt.getTime() !== expectedStartedAt.getTime() ||
    input.policyVersion !== expectedPolicy
  ) {
    throw new CostConfigError(
      "Cost ledger configuration has drifted from the environment contract.",
    );
  }
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
