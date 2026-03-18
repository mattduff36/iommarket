import { describe, expect, it } from "vitest";
import {
  createMonitoringFingerprint,
  redactMonitoringPayload,
  coerceSeverity,
  maxSeverity,
} from "@/lib/monitoring";

describe("monitoring fingerprint", () => {
  it("is stable for equivalent errors", () => {
    const a = createMonitoringFingerprint({
      source: "SERVER",
      message: "Payment failed for listing 12345",
      stack: "Error: boom\nat payForListing (actions/payments.ts:101:12)",
      route: "/sell/checkout",
      action: "payForListing",
    });
    const b = createMonitoringFingerprint({
      source: "SERVER",
      message: "Payment failed for listing 98765",
      stack: "Error: boom\nat payForListing (actions/payments.ts:101:12)",
      route: "/sell/checkout",
      action: "payForListing",
    });

    expect(a).toBe(b);
  });

  it("changes when source changes", () => {
    const a = createMonitoringFingerprint({
      source: "SERVER",
      message: "Unhandled exception",
      stack: "at saveListing",
    });
    const b = createMonitoringFingerprint({
      source: "CLIENT",
      message: "Unhandled exception",
      stack: "at saveListing",
    });

    expect(a).not.toBe(b);
  });
});

describe("monitoring redaction", () => {
  it("redacts sensitive keys and masks email values", () => {
    const input = {
      apiKey: "secret-123",
      authToken: "token-abc",
      reporterEmail: "alice@example.com",
      nested: {
        password: "super-secret",
        safe: "ok",
      },
    };

    const redacted = redactMonitoringPayload(input);

    expect(redacted).toEqual({
      apiKey: "[redacted]",
      authToken: "[redacted]",
      reporterEmail: "al***@example.com",
      nested: {
        password: "[redacted]",
        safe: "ok",
      },
    });
  });
});

describe("monitoring severity helpers", () => {
  it("uses source defaults when severity is not provided", () => {
    expect(coerceSeverity(undefined, "SERVER")).toBe("HIGH");
    expect(coerceSeverity(undefined, "BUSINESS")).toBe("MEDIUM");
  });

  it("keeps the higher severity when merging", () => {
    expect(maxSeverity("MEDIUM", "LOW")).toBe("MEDIUM");
    expect(maxSeverity("HIGH", "CRITICAL")).toBe("CRITICAL");
  });
});
