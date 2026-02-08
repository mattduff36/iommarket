import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first request", () => {
    const result = checkRateLimit("test-unique-key-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("blocks after exceeding limit", () => {
    const key = "test-limit-key";
    const config = { windowMs: 60_000, maxRequests: 3 };

    checkRateLimit(key, config);
    checkRateLimit(key, config);
    checkRateLimit(key, config);

    const result = checkRateLimit(key, config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns correct remaining count", () => {
    const key = "test-remaining-key";
    const config = { windowMs: 60_000, maxRequests: 5 };

    const r1 = checkRateLimit(key, config);
    expect(r1.remaining).toBe(4);

    const r2 = checkRateLimit(key, config);
    expect(r2.remaining).toBe(3);
  });
});
