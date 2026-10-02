import { describe, expect, it } from "vitest";
import { decideMonitoringAlert } from "@/lib/monitoring/alert-policy";

const now = new Date("2026-10-02T12:00:00.000Z");

function decide(overrides: Partial<Parameters<typeof decideMonitoringAlert>[0]> = {}) {
  return decideMonitoringAlert({
    status: "OPEN",
    severity: "HIGH",
    eventSeverity: "HIGH",
    now,
    minSeverity: "HIGH",
    cooldownMinutes: 30,
    hasChannel: true,
    ...overrides,
  });
}

describe("monitoring alert policy", () => {
  it("sends critical issues immediately despite cooldown", () => {
    expect(decide({
      severity: "CRITICAL",
      eventSeverity: "CRITICAL",
      lastAlertedAt: new Date(now.getTime() - 60_000),
    })).toEqual({ action: "send", reason: "critical" });
  });

  it("suppresses an acknowledged issue until it escalates or recurs", () => {
    expect(decide({
      status: "ACKNOWLEDGED",
      acknowledgedSeverity: "HIGH",
      previousLastSeenAt: new Date(now.getTime() - 60_000),
    })).toEqual({ action: "suppress", reason: "acknowledged" });

    expect(decide({
      status: "ACKNOWLEDGED",
      acknowledgedSeverity: "HIGH",
      eventSeverity: "CRITICAL",
      severity: "CRITICAL",
    })).toEqual({ action: "send", reason: "escalation" });

    expect(decide({
      status: "ACKNOWLEDGED",
      acknowledgedSeverity: "HIGH",
      previousLastSeenAt: new Date(now.getTime() - 7 * 60 * 60 * 1000),
    })).toEqual({ action: "send", reason: "recurrence" });
  });

  it("treats an expired mute as alertable and digests lower severity", () => {
    expect(decide({
      status: "MUTED",
      mutedUntil: new Date(now.getTime() - 1000),
    })).toEqual({ action: "send", reason: "threshold" });
    expect(decide({ severity: "LOW", eventSeverity: "LOW" })).toEqual({
      action: "digest",
      reason: "below-threshold",
    });
  });
});
