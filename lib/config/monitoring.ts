import { getNumberSetting, getStringSetting, SETTING_KEYS } from "./site-settings";
import type { MonitoringSeverity } from "@/lib/monitoring/types";

const DEFAULT_MIN_SEVERITY: MonitoringSeverity = "HIGH";
const DEFAULT_COOLDOWN_MINUTES = 30;

function parseSeverity(value: string): MonitoringSeverity {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "LOW" ||
    normalized === "MEDIUM" ||
    normalized === "HIGH" ||
    normalized === "CRITICAL"
  ) {
    return normalized;
  }
  return DEFAULT_MIN_SEVERITY;
}

function parseRecipients(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export async function getMonitoringAlertEmailRecipientsAsync(): Promise<string[]> {
  const fallback =
    process.env.MONITORING_ALERT_EMAILS ??
    process.env.RESEND_REPORTS_TO_EMAIL ??
    "";
  const raw = await getStringSetting(SETTING_KEYS.MONITORING_ALERT_EMAILS, fallback);
  return parseRecipients(raw);
}

export async function getMonitoringAlertWebhookUrlAsync(): Promise<string> {
  const fallback = process.env.MONITORING_ALERT_WEBHOOK_URL ?? "";
  return getStringSetting(SETTING_KEYS.MONITORING_ALERT_WEBHOOK_URL, fallback);
}

export async function getMonitoringAlertMinSeverityAsync(): Promise<MonitoringSeverity> {
  const fallback = process.env.MONITORING_ALERT_MIN_SEVERITY ?? DEFAULT_MIN_SEVERITY;
  const raw = await getStringSetting(SETTING_KEYS.MONITORING_ALERT_MIN_SEVERITY, fallback);
  return parseSeverity(raw);
}

export async function getMonitoringAlertCooldownMinutesAsync(): Promise<number> {
  const fallback = Number(process.env.MONITORING_ALERT_COOLDOWN_MINUTES ?? DEFAULT_COOLDOWN_MINUTES);
  const value = await getNumberSetting(
    SETTING_KEYS.MONITORING_ALERT_COOLDOWN_MINUTES,
    Number.isNaN(fallback) ? DEFAULT_COOLDOWN_MINUTES : fallback
  );
  if (value < 0) return 0;
  return Math.floor(value);
}
