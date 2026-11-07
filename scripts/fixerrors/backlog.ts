import { redactFreeText } from "@/lib/monitoring/redact";
import type { PgClientLike } from "./types";

/** Read-only companion to the signed OPEN snapshot; it grants no mutation authority. */
export async function acknowledgedBacklogReport(client: PgClientLike): Promise<string> {
  const result = await client.query(`
    SELECT issue.id, issue."sampleMessage", issue."sampleRoute", issue.occurrences,
           to_char(issue."lastSeenAt", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lastSeenAt", latest.notes,
           (SELECT COUNT(*)::int FROM "MonitoringEvent" event WHERE event."issueId" = issue.id) AS "eventCount"
    FROM "MonitoringIssue" issue
    LEFT JOIN LATERAL (
      SELECT notes FROM "MonitoringIssueStatusEvent" status_event
      WHERE status_event."issueId" = issue.id ORDER BY "createdAt" DESC, id DESC LIMIT 1
    ) latest ON true
    WHERE issue.status = 'ACKNOWLEDGED'
    ORDER BY issue."lastSeenAt" DESC, issue.id ASC`);
  const safe = (value: unknown) => redactFreeText(String(value ?? "not recorded")).replace(/[\r\n]/g, " ");
  return [
    "# Unresolved acknowledged backlog", "",
    `${result.rows.length} acknowledged issue(s) still require a verified fix or a concrete evidence-collection action.`,
    "Acknowledged does not mean fixed. This report is read-only and is not a signed mutation snapshot.",
    "Do not claim the queue is clear based only on the OPEN count.", "",
    ...result.rows.flatMap(row => [
      `## ${safe(row.id)}`, `- Message: ${safe(row.sampleMessage)}`,
      `- Route: ${safe(row.sampleRoute)}`, `- Occurrences: ${safe(row.occurrences)}`,
      `- Last seen: ${safe(row.lastSeenAt)}`, `- Retained events: ${safe(row.eventCount)}`,
      `- Recorded next step: ${safe(row.notes)}`, "",
    ]),
  ].join("\n");
}
