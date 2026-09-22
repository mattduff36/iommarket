import { limitWithUpstash, resetUpstashLimitersForTests } from "@/lib/rate-limit-upstash";
import type { RuntimeEnv } from "@/lib/runtime-env";
import type { RateLimitResult } from "@/lib/rate-limit-result";

export type { RateLimitDenial, RateLimitResult } from "@/lib/rate-limit-result";
export {
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  rateLimitActionError,
  toRateLimitDenial,
} from "@/lib/rate-limit-result";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  policy?: string;
}

const DEFAULTS: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 10,
};

export const RATE_LIMIT_POLICIES = {
  devAuth: { windowMs: 15 * 60_000, maxRequests: 8, policy: "dev-auth" },
} as const satisfies Record<string, RateLimitConfig>;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastCleanupAt = 0;

export type RateLimitBackend = "memory" | "upstash" | "unavailable";

export function rateLimitEnvironmentLabel(env: RuntimeEnv): "production" | "preview" | "test" | "development" {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.NODE_ENV === "test") return "test";
  return "development";
}

export function rateLimitPrefix(env: RuntimeEnv = process.env): string {
  return `iommarket:${rateLimitEnvironmentLabel(env)}:`;
}

export function resolveRateLimitBackend(env: RuntimeEnv = process.env): RateLimitBackend {
  const hosted = env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production";
  const hasUpstash = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  if (hosted) return hasUpstash ? "upstash" : "unavailable";
  if (env.RATE_LIMIT_STORE === "upstash") return hasUpstash ? "upstash" : "unavailable";
  return "memory";
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
  lastCleanupAt = 0;
  resetUpstashLimitersForTests();
}

function unavailable(now: number, windowMs: number): RateLimitResult {
  return { allowed: false, remaining: 0, resetAt: now + windowMs, unavailable: true };
}

function limitInMemory(storageKey: string, maxRequests: number, windowMs: number, now: number): RateLimitResult {
  if (now - lastCleanupAt > 60_000) {
    for (const [mapKey, value] of buckets.entries()) {
      if (value.resetAt < now) buckets.delete(mapKey);
    }
    lastCleanupAt = now;
  }

  const entry = buckets.get(storageKey);
  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs;
    buckets.set(storageKey, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt, unavailable: false };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, unavailable: false };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
    unavailable: false,
  };
}

export async function checkRateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {},
  options: { now?: number; env?: RuntimeEnv } = {},
): Promise<RateLimitResult> {
  const { windowMs, maxRequests, policy } = { ...DEFAULTS, ...config };
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const prefix = `${rateLimitPrefix(env)}${policy ? `${policy}:` : ""}`;
  const backend = resolveRateLimitBackend(env);

  if (backend === "unavailable") return unavailable(now, windowMs);
  if (backend === "upstash") {
    return limitWithUpstash({
      key,
      maxRequests,
      windowMs,
      prefix,
      url: env.UPSTASH_REDIS_REST_URL ?? "",
      token: env.UPSTASH_REDIS_REST_TOKEN ?? "",
      now,
    });
  }

  return limitInMemory(`${prefix}${key}`, maxRequests, windowMs, now);
}

export function makeRateLimitKey(scope: string, identifier: string): string {
  return `${scope}:${identifier.trim().toLowerCase()}`;
}
