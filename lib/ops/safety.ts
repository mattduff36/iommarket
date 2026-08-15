type EnvLike = Record<string, string | undefined>;

export function assertSeedAllowed(env: EnvLike = process.env) {
  if (env.SEED_ALLOW !== "1") {
    throw new Error("Refusing to seed without SEED_ALLOW=1.");
  }
}

export function assertE2ECleanupAllowed(env: EnvLike = process.env) {
  if (env.E2E_ALLOW_DB_MUTATION !== "1" && env.NODE_ENV === "production") {
    throw new Error("Refusing E2E database cleanup without E2E_ALLOW_DB_MUTATION=1.");
  }
}

export function isDevBypassAllowed(env: EnvLike = process.env) {
  return env.NODE_ENV !== "production" && env.ALLOW_DEV_BYPASS === "1";
}

export function isCronAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined,
) {
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
