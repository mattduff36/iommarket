import type { MonitoringSeverity, MonitoringSource } from "./types";

const RANK: Record<MonitoringSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function maxSeverity(
  a: MonitoringSeverity,
  b: MonitoringSeverity
): MonitoringSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

export function defaultSeverityForSource(
  source: MonitoringSource
): MonitoringSeverity {
  switch (source) {
    case "WEBHOOK":
      return "HIGH";
    case "BUSINESS":
      return "MEDIUM";
    case "CLIENT":
      return "MEDIUM";
    case "SERVER":
    default:
      return "HIGH";
  }
}

export function coerceSeverity(
  severity: MonitoringSeverity | undefined,
  source: MonitoringSource
): MonitoringSeverity {
  return severity ?? defaultSeverityForSource(source);
}
