import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { RateLimitResult } from "@/lib/rate-limit-result";

const limiters = new Map<string, Ratelimit>();
const UPSTASH_TIMEOUT_MS = 1_500;

export function resetUpstashLimitersForTests(): void {
  limiters.clear();
}

export function rateLimitWindow(windowMs: number): Duration {
  if (windowMs % 86_400_000 === 0) return `${windowMs / 86_400_000} d`;
  if (windowMs % 3_600_000 === 0) return `${windowMs / 3_600_000} h`;
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} m`;
  if (windowMs % 1_000 === 0) return `${windowMs / 1_000} s`;
  return `${windowMs} ms`;
}

function limiterFor(input: {
  url: string;
  token: string;
  prefix: string;
  maxRequests: number;
  windowMs: number;
}): Ratelimit {
  const cacheKey = `${input.prefix}:${input.maxRequests}:${input.windowMs}:${input.url}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;
  const limiter = new Ratelimit({
    redis: new Redis({ url: input.url, token: input.token }),
    limiter: Ratelimit.slidingWindow(input.maxRequests, rateLimitWindow(input.windowMs)),
    prefix: input.prefix,
    analytics: false,
    ephemeralCache: false,
    enableTelemetry: false,
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

function unavailable(now: number, windowMs: number): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    resetAt: now + windowMs,
    unavailable: true,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("RATE_LIMIT_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function limitWithUpstash(input: {
  key: string;
  maxRequests: number;
  windowMs: number;
  prefix: string;
  url: string;
  token: string;
  now: number;
}): Promise<RateLimitResult> {
  try {
    const limiter = limiterFor(input);
    const result = await withTimeout(limiter.limit(input.key), UPSTASH_TIMEOUT_MS);
    if (result.reason === "timeout") return unavailable(input.now, input.windowMs);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
      unavailable: false,
    };
  } catch {
    return unavailable(input.now, input.windowMs);
  }
}
