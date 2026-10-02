import { describe, expect, it } from "vitest";
import {
  assertDisposableE2EFixtureAllowed,
  assertE2ECleanupAllowed,
  assertSeedAllowed,
  isCronAuthorized,
  isDevBypassAllowed,
  isDisposableE2EEmail,
} from "@/lib/ops/safety";

describe("ops safety ALR-OPS-001", () => {
  it("refuses seed without an explicit allow flag", () => {
    expect(() => assertSeedAllowed({})).toThrow("SEED_ALLOW=1");
    expect(() => assertSeedAllowed({ SEED_ALLOW: "1" })).not.toThrow();
  });

  it("refuses production E2E cleanup without an explicit mutation flag", () => {
    expect(() =>
      assertE2ECleanupAllowed({ NODE_ENV: "production" }),
    ).toThrow("E2E_ALLOW_DB_MUTATION=1");
    expect(() =>
      assertE2ECleanupAllowed({
        NODE_ENV: "production",
        E2E_ALLOW_DB_MUTATION: "1",
      }),
    ).not.toThrow();
  });

  it("refuses disposable account fixtures in production and against the production database", () => {
    expect(isDisposableE2EEmail("e2e-actions-member-123e4567-e89b-12d3-a456-426614174000@example.com")).toBe(true);
    expect(isDisposableE2EEmail("admin@itrader.im")).toBe(false);
    expect(isDisposableE2EEmail("e2e-actions-member-123e4567-e89b-12d3-a456-426614174000@gmail.com")).toBe(false);
    expect(() =>
      assertDisposableE2EFixtureAllowed({ NODE_ENV: "production" }),
    ).toThrow("production");
    expect(() =>
      assertDisposableE2EFixtureAllowed({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://postgres.snlqivvogfqesxpbjiei:secret@db.example/postgres",
      }),
    ).toThrow("production database");
    expect(() =>
      assertDisposableE2EFixtureAllowed({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).not.toThrow();
    expect(() =>
      assertDisposableE2EFixtureAllowed({
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://postgres@db.syneonzucehwlghqmfbg.supabase.co/postgres",
        NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
      }),
    ).not.toThrow();
    expect(() =>
      assertDisposableE2EFixtureAllowed({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow("production");
  });

  it("keeps cron and dev bypass authenticated", () => {
    expect(isCronAuthorized("Bearer secret", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer secret", "secret")).toBe(true);
    expect(isCronAuthorized("Bearer other", "secret")).toBe(false);
    expect(isDevBypassAllowed({ NODE_ENV: "production", ALLOW_DEV_BYPASS: "1" })).toBe(
      false,
    );
    expect(isDevBypassAllowed({ NODE_ENV: "development", ALLOW_DEV_BYPASS: "1" })).toBe(
      true,
    );
  });
});
