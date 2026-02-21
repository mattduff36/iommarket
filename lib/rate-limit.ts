/**
 * Simple in-memory rate limiter for MVP.
 * Replace with @upstash/ratelimit for production multi-instance deployments.
 */

const requests = new Map<string, { count: number; resetAt: number }>();
let lastCleanupAt = 0;

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULTS: RateLimitConfig = {
  windowMs: 60_000, // 1 minute
  maxRequests: 10,
};

export function checkRateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const { windowMs, maxRequests } = { ...DEFAULTS, ...config };
  const now = Date.now();

  // Opportunistic cleanup to avoid unbounded growth.
  if (now - lastCleanupAt > 60_000) {
    for (const [mapKey, value] of requests.entries()) {
      if (value.resetAt < now) requests.delete(mapKey);
    }
    lastCleanupAt = now;
  }

  const entry = requests.get(key);

  if (!entry || entry.resetAt < now) {
    requests.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

export function makeRateLimitKey(scope: string, identifier: string): string {
  return `${scope}:${identifier.trim().toLowerCase()}`;
}
