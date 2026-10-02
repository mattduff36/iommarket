import { severityRank } from "./severity";
import type { MonitoringSeverity } from "./types";

export const DEFAULT_RECURRENCE_WINDOW_MS = 6 * 60 * 60 * 1000;

export type AlertDecisionReason =
  | "critical"
  | "threshold"
  | "escalation"
  | "recurrence"
  | "reopened"
  | "below-threshold"
  | "muted"
  | "acknowledged"
  | "cooldown"
  | "no-channel";

export type AlertDecision =
  | { action: "send"; reason: "critical" | "threshold" | "escalation" | "recurrence" | "reopened" }
  | { action: "digest"; reason: "below-threshold" }
  | { action: "suppress"; reason: "muted" | "acknowledged" | "cooldown" | "no-channel" };

export interface AlertPolicyInput {
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  reopened?: boolean;
  severity: MonitoringSeverity;
  eventSeverity: MonitoringSeverity;
  acknowledgedSeverity?: MonitoringSeverity | null;
  mutedUntil?: Date | null;
  lastAlertedAt?: Date | null;
  previousLastSeenAt?: Date | null;
  now: Date;
  minSeverity: MonitoringSeverity;
  cooldownMinutes: number;
  recurrenceWindowMs?: number;
  hasChannel: boolean;
}

function meetsMinimum(severity: MonitoringSeverity, minimum: MonitoringSeverity): boolean {
  return severityRank(severity) >= severityRank(minimum);
}

function isEscalation(input: AlertPolicyInput): boolean {
  if (input.status !== "ACKNOWLEDGED" || !input.acknowledgedSeverity) return false;
  return severityRank(input.eventSeverity) > severityRank(input.acknowledgedSeverity);
}

function isRecurrence(input: AlertPolicyInput): boolean {
  if (input.status !== "ACKNOWLEDGED" || !input.previousLastSeenAt) return false;
  const windowMs = input.recurrenceWindowMs ?? DEFAULT_RECURRENCE_WINDOW_MS;
  return input.now.getTime() - input.previousLastSeenAt.getTime() >= windowMs;
}

export function decideMonitoringAlert(input: AlertPolicyInput): AlertDecision {
  if (!input.hasChannel) return { action: "suppress", reason: "no-channel" };

  const muteActive = input.status === "MUTED"
    && input.mutedUntil != null
    && input.mutedUntil.getTime() > input.now.getTime();
  if (muteActive) return { action: "suppress", reason: "muted" };

  const escalation = isEscalation(input);
  const recurrence = isRecurrence(input);
  if (input.status === "ACKNOWLEDGED" && !escalation && !recurrence) {
    return { action: "suppress", reason: "acknowledged" };
  }

  if (!meetsMinimum(input.severity, input.minSeverity)) {
    return { action: "digest", reason: "below-threshold" };
  }

  if (input.reopened) return { action: "send", reason: "reopened" };
  if (escalation) return { action: "send", reason: "escalation" };
  if (recurrence) return { action: "send", reason: "recurrence" };
  if (input.severity === "CRITICAL") return { action: "send", reason: "critical" };

  if (input.lastAlertedAt && input.cooldownMinutes > 0) {
    const elapsedMs = input.now.getTime() - input.lastAlertedAt.getTime();
    if (elapsedMs < input.cooldownMinutes * 60 * 1000) {
      return { action: "suppress", reason: "cooldown" };
    }
  }

  return { action: "send", reason: "threshold" };
}

export function alertRetryDelayMs(attempts: number): number {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  return schedule[Math.min(Math.max(attempts, 1) - 1, schedule.length - 1)] ?? 60 * 60_000;
}

export const MAX_ALERT_ATTEMPTS = 5;
