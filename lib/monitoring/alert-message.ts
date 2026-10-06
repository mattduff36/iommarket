import { explainMonitoringAlert } from "./plain-alert";
import type { MonitoringSeverity } from "./types";

export function normaliseAlertSubject(subject: string): string {
  return subject.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 300);
}

interface AlertCopyInput {
  severity: MonitoringSeverity;
  title: string;
  message?: string;
  route?: string | null;
  action?: string | null;
  environment?: string | null;
  occurrences?: number;
}

function alertCopy(params: AlertCopyInput) {
  return explainMonitoringAlert({
    title: params.title,
    message: params.message ?? params.title,
    route: params.route,
    action: params.action,
    environment: params.environment,
    occurrences: params.occurrences,
    severity: params.severity,
  });
}

export function buildAlertSubject(params: AlertCopyInput) {
  return normaliseAlertSubject(`[Monitoring] [${params.severity}] - ${alertCopy(params).subject}`);
}

export function buildAlertText(params: AlertCopyInput & { issueId: string; appUrl: string }) {
  const plain = alertCopy(params);
  const issueUrl = `${params.appUrl.replace(/\/$/, "")}/admin/monitoring/${params.issueId}`;
  return [plain.summary, "", `${plain.check}: ${issueUrl}`].join("\n");
}

export function monitoringAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
