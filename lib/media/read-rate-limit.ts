import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import type { RateLimitResult } from "@/lib/rate-limit-result";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 240;
const MAX_BUCKETS = 5_000;
const RETRY_MS = 60_000;

/** Read-only media resilience, never an authorisation decision.
 * The fallback is per process, not a distributed abuse/security boundary.
 * All callers must still check access to the requested image.
 */
export function createMediaReadLimiter(
  shared: typeof checkRateLimit = checkRateLimit,
  now: () => number = Date.now,
  warn: () => void = () => console.warn("media-rate-limit: shared backend unavailable; using bounded local protection"),
) {
  const buckets = new Map<string, { count: number; resetAt: number; deniedUntil?: number }>();
  let cleanupAt = 0;
  let retryAt = 0;
  return async (identifier: string): Promise<RateLimitResult> => {
    const time = now();
    if (time >= cleanupAt) {
      for (const [key, bucket] of buckets) if (Math.max(bucket.resetAt, bucket.deniedUntil ?? 0) <= time) buckets.delete(key);
      cleanupAt = time + WINDOW_MS;
    }
    // Bound both key length and the number of retained clients.
    const key = identifier.trim().toLowerCase().slice(0, 128) || "unknown";
    let bucket = buckets.get(key);
    if (bucket?.deniedUntil && bucket.deniedUntil > time) {
      return { allowed: false, remaining: 0, resetAt: bucket.deniedUntil, unavailable: false };
    }
    if (!bucket || bucket.resetAt <= time) {
      if (!bucket && buckets.size >= MAX_BUCKETS) {
        return { allowed: false, remaining: 0, resetAt: cleanupAt, unavailable: false };
      }
      bucket = { count: 0, resetAt: time + WINDOW_MS };
      buckets.set(key, bucket);
    }
    if (bucket.count >= MAX_REQUESTS) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt, unavailable: false };
    }
    bucket.count += 1;
    const local = { allowed: true, remaining: MAX_REQUESTS - bucket.count, resetAt: bucket.resetAt, unavailable: false };
    if (time < retryAt) return local;

    const result = await shared(makeRateLimitKey("media-delivery", key), {
      windowMs: WINDOW_MS, maxRequests: MAX_REQUESTS, policy: "media-delivery",
    });
    if (!result.unavailable) {
      if (!result.allowed) bucket.deniedUntil = result.resetAt;
      return result;
    }
    if (now() >= retryAt) {
      retryAt = now() + RETRY_MS;
      warn();
    }
    return local;
  };
}

export const checkMediaReadRateLimit = createMediaReadLimiter();
