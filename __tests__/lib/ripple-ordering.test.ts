import { describe, expect, it } from "vitest";
import { decideProviderEventApplication } from "@/lib/payments/webhook-ordering";

describe("RIP-ORDER-001 provider event ordering", () => {
  const base = {
    existingFingerprint: "a",
    incomingFingerprint: "b",
  };

  it("applies newer events and ignores stale ones", () => {
    expect(
      decideProviderEventApplication({
        ...base,
        existingAt: new Date("2026-08-15T10:00:00.000Z"),
        existingType: "payment.received",
        incomingAt: new Date("2026-08-15T11:00:00.000Z"),
        incomingType: "payment.failed",
      })
    ).toBe("apply");
    expect(
      decideProviderEventApplication({
        ...base,
        existingAt: new Date("2026-08-15T11:00:00.000Z"),
        existingType: "payment.failed",
        incomingAt: new Date("2026-08-15T10:00:00.000Z"),
        incomingType: "payment.received",
      })
    ).toBe("stale");
  });

  it("keeps conservative same-timestamp events", () => {
    expect(
      decideProviderEventApplication({
        ...base,
        existingAt: new Date("2026-08-15T10:00:00.000Z"),
        existingType: "payment.received",
        incomingAt: new Date("2026-08-15T10:00:00.000Z"),
        incomingType: "payment.failed",
      })
    ).toBe("apply");
    expect(
      decideProviderEventApplication({
        ...base,
        existingAt: new Date("2026-08-15T10:00:00.000Z"),
        existingType: "payment.failed",
        incomingAt: new Date("2026-08-15T10:00:00.000Z"),
        incomingType: "payment.received",
      })
    ).toBe("keep-conservative");
  });

  it("treats matching fingerprints as duplicates", () => {
    expect(
      decideProviderEventApplication({
        existingAt: new Date("2026-08-15T10:00:00.000Z"),
        existingType: "payment.received",
        existingFingerprint: "same",
        incomingAt: new Date("2026-08-15T11:00:00.000Z"),
        incomingType: "payment.received",
        incomingFingerprint: "same",
      })
    ).toBe("duplicate");
  });
});
