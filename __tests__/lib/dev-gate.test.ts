import { describe, expect, it } from "vitest";
import { shouldEnforceDevGate } from "@/lib/dev-gate";
import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";

const beforeLaunch = PUBLIC_LAUNCH_AT - 1;

describe("DEV-GATE-001 holding-page password", () => {
  it("does not enforce the /dev gate on Vercel Preview", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it("can reproduce the production gate on Preview only when QA is exactly 1", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        PREVIEW_LAUNCH_GATE_QA: "1",
      }),
    ).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        PREVIEW_LAUNCH_GATE_QA: "true",
      }),
    ).toBe(false);
  });

  it("enforces the gate on Vercel Production until 10:00 BST", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }, beforeLaunch),
    ).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }, PUBLIC_LAUNCH_AT),
    ).toBe(false);
  });

  it("opens production early only when the launch flag is exactly 1", () => {
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "1",
      }, beforeLaunch),
    ).toBe(false);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "true",
      }, beforeLaunch),
    ).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        PRODUCTION_LAUNCH_ENABLED: "0",
      }, beforeLaunch),
    ).toBe(true);
  });

  it("enforces the gate for local and development runtimes until 10:00 BST", () => {
    expect(shouldEnforceDevGate({ NODE_ENV: "test" }, beforeLaunch)).toBe(true);
    expect(
      shouldEnforceDevGate({
        NODE_ENV: "development",
        VERCEL_ENV: "development",
      }, beforeLaunch),
    ).toBe(true);
    expect(shouldEnforceDevGate({ NODE_ENV: "production" }, beforeLaunch)).toBe(true);
    expect(shouldEnforceDevGate({ NODE_ENV: "production" }, PUBLIC_LAUNCH_AT)).toBe(false);
  });
});
