import { describe, expect, it } from "vitest";
import {
  assertE2ECleanupAllowed,
  assertSeedAllowed,
  isCronAuthorized,
  isDevBypassAllowed,
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
