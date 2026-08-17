/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { assertEnvCheckSafety } from "@/e2e/env-check-safety";

const enabled = {
  destructiveChecksEnabled: "1",
  targetAttestation: "non-production",
};

describe("destructive environment-check safety", () => {
  it("requires both explicit opt-in values", () => {
    expect(() =>
      assertEnvCheckSafety({
        destructiveChecksEnabled: undefined,
        targetAttestation: "non-production",
        baseUrl: "http://localhost:4000",
      }),
    ).toThrow("Environment checks are destructive");

    expect(() =>
      assertEnvCheckSafety({
        destructiveChecksEnabled: "1",
        targetAttestation: undefined,
        baseUrl: "http://localhost:4000",
      }),
    ).toThrow("Environment checks are destructive");
  });

  it.each([
    "https://itrader.im",
    "https://www.itrader.im",
    "https://itrader.im.",
    "https://preview.itrader.im.",
    "https://iommarket.vercel.app",
    "https://iommarket-git-main.example.vercel.app.",
  ])("blocks the production domain variant %s", (baseUrl) => {
    expect(() => assertEnvCheckSafety({ ...enabled, baseUrl })).toThrow(
      "blocked against the production domain",
    );
  });

  it("blocks configured production hosts and their subdomains", () => {
    expect(() =>
      assertEnvCheckSafety({
        ...enabled,
        baseUrl: "https://preview.marketplace.example",
        blockedBaseUrls: [
          "https://marketplace.example",
          "iommarket.vercel.app",
        ],
      }),
    ).toThrow("blocked against the production domain");
  });

  it("allows an explicitly attested local target", () => {
    expect(() =>
      assertEnvCheckSafety({
        ...enabled,
        baseUrl: "http://localhost:4000",
        blockedBaseUrls: [
          "http://localhost:4000",
          "http://127.0.0.1:4000",
          "https://itrader.im",
          "iommarket.vercel.app",
          undefined,
        ],
      }),
    ).not.toThrow();
  });
});
