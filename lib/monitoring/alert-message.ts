import type { MonitoringSeverity } from "./types";

export function buildAlertSubject(params: {
  severity: MonitoringSeverity;
  source: string;
  title: string;
}) {
  return `[Monitoring][${params.severity}] ${params.source} - ${params.title}`;
}

export function buildAlertText(params: {
  issueId: string;
  eventId: string;
  severity: MonitoringSeverity;
  status: string;
  source: string;
  title: string;
  message: string;
  route?: string | null;
  action?: string | null;
  requestPath?: string | null;
  environment: string;
  occurrences: number;
  reason: string;
  appUrl: string;
}) {
  const issueUrl = `${params.appUrl}/admin/monitoring/${params.issueId}`;
  return [
    "iTrader Monitoring Alert",
    "",
    `Issue: ${params.issueId}`,
    `Event: ${params.eventId}`,
    `Severity: ${params.severity}`,
    `Status: ${params.status}`,
    `Source: ${params.source}`,
    `Environment: ${params.environment}`,
    `Occurrences: ${params.occurrences}`,
    `Reason: ${params.reason}`,
    "",
    `Title: ${params.title}`,
    `Message: ${params.message}`,
    `Route: ${params.route ?? "n/a"}`,
    `Action: ${params.action ?? "n/a"}`,
    `Request path: ${params.requestPath ?? "n/a"}`,
    "",
    `Review in admin: ${issueUrl}`,
  ].join("\n");
}

export function monitoringAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
