const PREVIEW_PROJECT = "syneonzucehwlghqmfbg";
const PRODUCTION_PROJECT = "snlqivvogfqesxpbjiei";
const DATABASE_KEYS = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"] as const;

export function mediaDatabaseIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "local";
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)?.[1];
    if (direct) return direct.toLowerCase();
    if (!url.hostname.endsWith(".pooler.supabase.com")) return null;
    return /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(url.username))?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** No production credential may enable a development media write, even on localhost. */
export function isImageKitDevelopmentEnvironment(env: NodeJS.ProcessEnv): boolean {
  if (env.VERCEL_ENV === "production") return false;
  let origin: URL | null = null;
  try {
    if (env.NEXT_PUBLIC_APP_URL) origin = new URL(env.NEXT_PUBLIC_APP_URL);
    if (env.NEXT_PUBLIC_SUPABASE_URL &&
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${PREVIEW_PROJECT}.supabase.co`) return false;
  } catch {
    return false;
  }
  if (origin && ["itrader.im", "www.itrader.im"].includes(origin.hostname)) return false;
  const identities = DATABASE_KEYS.filter((key) => Boolean(env[key])).map((key) => mediaDatabaseIdentity(env[key]!));
  if (identities.some((identity) => identity === PRODUCTION_PROJECT ||
    (identity !== "local" && identity !== PREVIEW_PROJECT))) return false;
  if (new Set(identities).size > 1) return false;
  if (env.VERCEL_ENV === "preview") {
    return env.ITRADER_DEPLOYMENT_ROLE === "staging" &&
      env.NEXT_PUBLIC_APP_URL === "https://itrader.dev" &&
      identities.length > 0 && identities.every((identity) => identity === PREVIEW_PROJECT);
  }
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "development") return false;
  if (env.NODE_ENV === "test" && identities.length === 0 && !origin) return true;
  return identities.length > 0 && Boolean(origin &&
    ["localhost", "127.0.0.1"].includes(origin.hostname));
}
