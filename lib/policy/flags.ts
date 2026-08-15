export const BOOLEAN_FLAGS = [
  "POLICY_ENFORCE_ACCEPTANCE",
  "POLICY_ENFORCE_LISTING_NS",
  "POLICY_ENABLE_CANCELLATION_REQUESTS",
  "POLICY_ENABLE_DELETION_WORKER",
  "POLICY_RETENTION_MUTATE",
] as const;

export type PolicyBooleanFlag = (typeof BOOLEAN_FLAGS)[number];

export const RETENTION_ENTITY_TYPES = [
  "LISTING",
  "LISTING_VIEW",
  "REPORT",
  "DEALER_REVIEW",
  "MONITORING",
  "WAITLIST_USER",
] as const;

export type RetentionEntityType = (typeof RETENTION_ENTITY_TYPES)[number];

type EnvLike = Record<string, string | undefined>;

function readBooleanFlag(name: PolicyBooleanFlag, env: EnvLike) {
  const value = env[name];
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true, false, or absent`);
}

function readAllowlist(env: EnvLike): RetentionEntityType[] {
  const raw = env.POLICY_RETENTION_ENTITY_ALLOWLIST?.trim() ?? "";
  if (!raw) return [];
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const unknown = items.filter(
    (item) => !RETENTION_ENTITY_TYPES.includes(item as RetentionEntityType),
  );
  if (unknown.length > 0) {
    throw new Error(
      `POLICY_RETENTION_ENTITY_ALLOWLIST contains unknown types: ${unknown.join(", ")}`,
    );
  }
  return items as RetentionEntityType[];
}

export function getPolicyFlags(env: EnvLike = process.env) {
  const flags = {
    enforceAcceptance: readBooleanFlag("POLICY_ENFORCE_ACCEPTANCE", env),
    enforceListingNs: readBooleanFlag("POLICY_ENFORCE_LISTING_NS", env),
    enableCancellationRequests: readBooleanFlag(
      "POLICY_ENABLE_CANCELLATION_REQUESTS",
      env,
    ),
    enableDeletionWorker: readBooleanFlag("POLICY_ENABLE_DELETION_WORKER", env),
    retentionMutate: readBooleanFlag("POLICY_RETENTION_MUTATE", env),
    retentionEntityAllowlist: readAllowlist(env),
  };

  return {
    ...flags,
    canMutateRetention:
      flags.retentionMutate && flags.retentionEntityAllowlist.length > 0,
  };
}

export function assertPolicyFlagsValid(env: EnvLike = process.env) {
  getPolicyFlags(env);
}
