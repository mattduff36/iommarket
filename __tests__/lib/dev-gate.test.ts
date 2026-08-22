import { describe, expect, it } from "vitest";
import { shouldEnforceDevGate } from "@/lib/dev-gate";

describe("DEV-GATE-001 holding-page password", () => {
  it("does not enforce the /dev gate on Vercel Preview", () => {
    expect(shouldEnforceDevGate({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("enforces the /dev gate on Vercel Production", () => {
    expect(shouldEnforceDevGate({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("enforces the /dev gate for local and development runtimes", () => {
    expect(shouldEnforceDevGate({})).toBe(true);
    expect(shouldEnforceDevGate({ VERCEL_ENV: "development" })).toBe(true);
    expect(shouldEnforceDevGate({ NODE_ENV: "production" })).toBe(true);
  });
});
