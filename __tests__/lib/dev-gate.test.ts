import { describe, expect, it } from "vitest";
import { shouldEnforceDevGate } from "@/lib/dev-gate";

describe("DEV-GATE-001 holding-page password", () => {
  it("does not enforce the /dev gate on Vercel Preview", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it("enforces the /dev gate on Vercel Production", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
  });

  it("opens production only when the launch flag is exactly 1", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "1",
      }),
    ).toBe(false);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "0",
      }),
    ).toBe(true);
  });

  it("enforces the /dev gate for local and development runtimes", () => {
    expect(shouldEnforceDevGate({ NODE_ENV: "test" })).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "development",
        VERCEL_ENV: "development",
      }),
    ).toBe(true);
    expect(shouldEnforceDevGate({ NODE_ENV: "production" })).toBe(true);
  });
});
