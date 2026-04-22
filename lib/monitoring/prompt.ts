import type { MonitoringEvent, MonitoringIssue } from "@prisma/client";

function compact(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function suggestFiles(issue: MonitoringIssue, events: MonitoringEvent[]): string[] {
  const files = new Set<string>();
  const routeCandidates = [issue.sampleRoute, ...events.map((e) => e.route)];
  const actionCandidates = [issue.sampleAction, ...events.map((e) => e.action)];
  const pathCandidates = events.map((e) => e.requestPath);

  for (const action of actionCandidates) {
    const candidate = action?.toLowerCase() ?? "";
    if (!candidate) continue;
    if (
      candidate.includes("payforlisting") ||
      candidate.includes("createdealersubscription") ||
      candidate.includes("upgradefeatured")
    ) {
      files.add("actions/payments.ts");
    }
    if (
      candidate.includes("createlisting") ||
      candidate.includes("submitlistingforreview") ||
      candidate.includes("renewlisting") ||
      candidate.includes("contactseller") ||
      candidate.includes("reportlisting")
    ) {
      files.add("actions/listings.ts");
    }
    if (candidate.includes("moderate") || candidate.includes("admin")) {
      files.add("actions/admin.ts");
    }
  }

  for (const route of routeCandidates) {
    const candidate = route?.toLowerCase() ?? "";
    if (!candidate) continue;
    if (candidate.startsWith("/sell")) files.add("app/(public)/sell/page.tsx");
    if (candidate.startsWith("/listings/")) {
      files.add("app/(public)/listings/[id]/page.tsx");
    }
    if (candidate.startsWith("/dealer")) {
      files.add("app/(public)/dealer/dashboard/page.tsx");
    }
  }

  for (const requestPath of pathCandidates) {
    const candidate = requestPath?.toLowerCase() ?? "";
    if (!candidate) continue;
    if (candidate === "/api/webhooks/payments" || candidate === "/api/webhooks/ripple") {
      files.add("app/api/webhooks/payments/route.ts");
    }
    if (candidate.startsWith("/api/search")) files.add("app/api/search/route.ts");
  }

  if (issue.source === "CLIENT") {
    files.add("app/layout.tsx");
    files.add("components/monitoring/client-error-listener.tsx");
  }

  if (files.size === 0) {
    files.add("lib/monitoring/capture.ts");
  }

  return [...files];
}

function formatEventLines(events: MonitoringEvent[]): string {
  if (events.length === 0) return "- No event payloads available.";
  return events
    .slice(0, 5)
    .map((event, idx) => {
      const route = compact(event.route) ?? compact(event.requestPath) ?? "n/a";
      const action = compact(event.action) ?? "n/a";
      const msg = compact(event.message) ?? "No message";
      return `- Event ${idx + 1}: source=${event.source}, severity=${event.severity}, route=${route}, action=${action}, message="${msg}"`;
    })
    .join("\n");
}

export function buildCursorPrompt(params: {
  issue: MonitoringIssue;
  events: MonitoringEvent[];
}): string {
  const { issue, events } = params;
  const files = suggestFiles(issue, events);
  const primaryRoute = compact(issue.sampleRoute) ?? "n/a";
  const primaryAction = compact(issue.sampleAction) ?? "n/a";
  const primaryComponent = compact(issue.sampleComponent) ?? "n/a";

  return [
    "You are investigating a production issue in the iommarket codebase.",
    "",
    "Issue summary:",
    `- Issue ID: ${issue.id}`,
    `- Severity: ${issue.severity}`,
    `- Status: ${issue.status}`,
    `- Source: ${issue.source}`,
    `- Occurrences: ${issue.occurrences}`,
    `- First seen: ${issue.firstSeenAt.toISOString()}`,
    `- Last seen: ${issue.lastSeenAt.toISOString()}`,
    `- Sample message: ${issue.sampleMessage}`,
    `- Route hint: ${primaryRoute}`,
    `- Action hint: ${primaryAction}`,
    `- Component hint: ${primaryComponent}`,
    "",
    "Recent events:",
    formatEventLines(events),
    "",
    "What to check first:",
    "- Reproduce the failure path locally using the route/action hints.",
    "- Verify input validation and guard clauses in the suspected server action/route.",
    "- Confirm state transitions and idempotency where payments/webhooks are involved.",
    "- Verify auth/role checks and rate-limiting behavior on the failing path.",
    "- Add/adjust tests for the failing behavior before finalizing the fix.",
    "",
    "Suggested files to inspect first:",
    ...files.map((f) => `- ${f}`),
    "",
    "Please provide:",
    "1) Root cause analysis",
    "2) Concrete code fix",
    "3) Regression test updates",
    "4) Any follow-up hardening recommendations",
  ].join("\n");
}
