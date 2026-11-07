import { redactFreeText } from "./redact";
import { safeSupportReference } from "@/lib/forms/public-error";
import { browserDiagnostics, type ClientDiagnostics } from "./client-diagnostics";
import { requestDiagnostics } from "./request-diagnostics";

/** Report only the displayed error and pathname, never form values or URL query parameters. */
export function cleanReportedMessage(message: string): string {
  return redactFreeText(message.replace(/https?:\/\/[^\s<>]+/gi, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return "[URL removed]"; }
  })).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 2000);
}

export interface UserIssueReport {
  reportId: string;
  message: string;
  route: string;
  supportReference?: string;
  diagnostics?: ClientDiagnostics;
}

export async function sendUserIssueReport(report: UserIssueReport): Promise<string> {
  const response = await fetch("/api/monitoring/report-issue", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...report, requests: requestDiagnostics(), diagnostics: { ...report.diagnostics, ...browserDiagnostics() }, message: cleanReportedMessage(report.message), route: report.route.split(/[?#]/)[0] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  const reference = safeSupportReference(body?.reference);
  if (!response.ok || body?.ok !== true || !reference) {
    throw new Error(response.status === 429 ? "Please wait before reporting another issue." : "Could not send the report. Try again.");
  }
  return reference;
}
