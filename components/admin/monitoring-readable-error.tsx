import { ChevronDown } from "lucide-react";
import { explainMonitoringAlert } from "@/lib/monitoring/plain-alert";
import type { MonitoringSeverity } from "@/lib/monitoring/types";

const SEVERITIES = new Set<MonitoringSeverity>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export interface MonitoringErrorCopyInput {
  title: string;
  message: string;
  route?: string | null;
  action?: string | null;
  environment?: string | null;
  occurrences?: number;
  severity?: string | null;
  omitCount?: boolean;
}

export function monitoringErrorCopy(input: MonitoringErrorCopyInput) {
  const severity = input.severity && SEVERITIES.has(input.severity as MonitoringSeverity)
    ? (input.severity as MonitoringSeverity)
    : undefined;
  return explainMonitoringAlert({
    title: input.title,
    message: input.message,
    route: input.route,
    action: input.action,
    environment: input.environment,
    occurrences: input.occurrences,
    severity,
    omitCount: input.omitCount,
  });
}

function rawFailure(title: string, message: string): string {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const cleanMessage = message.trim();
  if (!cleanMessage || cleanTitle === cleanMessage.replace(/\s+/g, " ").trim()) return cleanMessage || cleanTitle;
  return `${cleanTitle}\n\n${cleanMessage}`;
}

export function MonitoringOriginalError({
  title,
  message,
  extra,
}: {
  title: string;
  message: string;
  extra?: string | null;
}) {
  const raw = rawFailure(title, message);
  return (
    <details className="group/raw rounded-md border border-border bg-canvas">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neon-blue-500 [&::-webkit-details-marker]:hidden">
        Original error
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform duration-200 group-open/raw:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-3">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
          {raw}
        </pre>
        {extra ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-tertiary">
            {extra}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
