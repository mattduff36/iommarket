/** Deliberately server-only configuration: a preview hostname alone grants nothing. */
export function isSampleCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  const raw = env.POSTGRES_URL ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL;
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.hostname === "db.syneonzucehwlghqmfbg.supabase.co" ||
      (url.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(url.username) === "postgres.syneonzucehwlghqmfbg");
  } catch { return false; }
}

export function assertSampleCheckoutEnabled() {
  if (!isSampleCheckoutEnabled()) throw new Error("Sample payments are unavailable in this environment.");
}

export const SAMPLE_MAX_ATTEMPTS = 3;
