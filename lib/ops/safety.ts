type EnvLike = Record<string, string | undefined>;

const PRODUCTION_SUPABASE_PROJECT_REF = "snlqivvogfqesxpbjiei";
const PREVIEW_SUPABASE_PROJECT_REF = "syneonzucehwlghqmfbg";
const DISPOSABLE_E2E_EMAIL =
  /^e2e-actions-(member|dealer)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.com$/i;

export function isDisposableE2EEmail(email: string) {
  return DISPOSABLE_E2E_EMAIL.test(email);
}

export function assertDisposableE2EFixtureAllowed(env: EnvLike = process.env) {
  const urls = [
    env.DATABASE_URL,
    env.POSTGRES_URL,
    env.POSTGRES_URL_NON_POOLING,
    env.NEXT_PUBLIC_SUPABASE_URL,
  ].filter((value): value is string => Boolean(value));
  const target = urls.join("\n").toLowerCase();
  if (target.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error("Refusing disposable E2E fixtures against the production database.");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing disposable E2E fixtures in production.");
  }
  const previewDatabase = urls.length > 0 && urls.every((url) =>
    url.toLowerCase().includes(PREVIEW_SUPABASE_PROJECT_REF),
  );
  if (env.VERCEL_ENV === "production" && !previewDatabase) {
    throw new Error("Refusing disposable E2E fixtures in production.");
  }
}

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
