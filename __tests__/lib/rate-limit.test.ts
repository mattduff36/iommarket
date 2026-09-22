import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  checkRateLimit,
  rateLimitPrefix,
  resetRateLimitsForTests,
  resolveRateLimitBackend,
} from "@/lib/rate-limit";
import { RATE_LIMIT_UNAVAILABLE_MESSAGE, toRateLimitDenial } from "@/lib/rate-limit-result";

const CALL_SITES = [
  "actions/listings.ts",
  "actions/payments.ts",
  "actions/waitlist.ts",
  "actions/dealer-onboarding.ts",
  "actions/admin/dealer-onboarding.ts",
  "lib/reviews/dealer-review-rate-limit.ts",
  "app/api/dev-auth/route.ts",
  "app/api/listing-images/intent/route.ts",
  "app/api/listing-images/finalize/route.ts",
  "app/api/vehicle-check/route.ts",
  "app/api/vehicle-catalogue/models/route.ts",
  "app/api/monitoring/events/route.ts",
  "app/api/dealer-profile/logo/route.ts",
];

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("allows the first request and then blocks inside the window", async () => {
    const key = "test-limit-key";
    const config = { windowMs: 60_000, maxRequests: 3 };
    const now = 1_000_000;

    expect((await checkRateLimit(key, config, { now })).remaining).toBe(2);
    await checkRateLimit(key, config, { now });
    await checkRateLimit(key, config, { now });
    const blocked = await checkRateLimit(key, config, { now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.unavailable).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBe(now + 60_000);

    const denial = toRateLimitDenial(blocked, "Too many requests", now);
    expect(denial).toEqual({
      status: 429,
      message: "Too many requests",
      retryAfterSeconds: 60,
    });
  });

  it("resets after the window and isolates preview from production", async () => {
    const now = 5_000;
    const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" };
    const production = { NODE_ENV: "production", VERCEL_ENV: "production", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" };
    expect(rateLimitPrefix(preview)).toBe("iommarket:preview:");
    expect(rateLimitPrefix(production)).toBe("iommarket:production:");
    expect(resolveRateLimitBackend(preview)).toBe("unavailable");
    expect(resolveRateLimitBackend({ NODE_ENV: "test" })).toBe("memory");

    const blocked = await checkRateLimit("shared", { maxRequests: 1, windowMs: 1_000 }, { now, env: preview });
    expect(blocked.unavailable).toBe(true);
    expect(toRateLimitDenial(blocked, "limited", now)?.status).toBe(503);
    expect(toRateLimitDenial(blocked, "limited", now)?.message).toBe(RATE_LIMIT_UNAVAILABLE_MESSAGE);

    const development = await checkRateLimit(
      "shared",
      { maxRequests: 1, windowMs: 1_000 },
      { now, env: { NODE_ENV: "development" } as NodeJS.ProcessEnv },
    );
    expect(development.allowed).toBe(true);

    const reset = await checkRateLimit(
      "window",
      { maxRequests: 1, windowMs: 1_000 },
      { now: now + 1_000, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv },
    );
    expect(reset.allowed).toBe(true);
  });

  it("keeps concurrent memory increments inside the limit", async () => {
    const now = 10_000;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkRateLimit("burst", { maxRequests: 5, windowMs: 60_000 }, { now, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed && !result.unavailable)).toHaveLength(3);
  });

  it("uses Upstash on hosted runtimes only when credentials exist", () => {
    expect(
      resolveRateLimitBackend({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
    ).toBe("upstash");
    expect(
      resolveRateLimitBackend({
        NODE_ENV: "development",
        RATE_LIMIT_STORE: "upstash",
      }),
    ).toBe("unavailable");
  });

  it("awaits every migrated rate-limit call site", () => {
    for (const file of CALL_SITES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const lines = source.split("\n").filter((line) => line.includes("checkRateLimit("));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.includes("await ") || line.includes("return checkRateLimit(")).toBe(true);
      }
    }
    const reviews = readFileSync(resolve(process.cwd(), "actions/dealer-reviews.ts"), "utf8");
    expect(reviews).toContain("await reviewRateAllowed(");
  });
});
