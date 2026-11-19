import { readInvestigation, resolutionLabels } from "@/lib/monitoring/investigation";

export function MonitoringInvestigation({ value, lastSeenAt, status }: {
  value: unknown; lastSeenAt: Date | string; status: string;
}) {
  const record = readInvestigation(value);
  if (!record) return <p className="text-sm text-text-secondary">Investigation record required: no structured evidence plan has been recorded.</p>;
  const recurred = record.observedLastSeenAt && new Date(lastSeenAt).getTime() > Date.parse(record.observedLastSeenAt);
  const closed = record.outcome === "resolved" && status === "RESOLVED" && !recurred;
  const reason = record.resolution && resolutionLabels[record.resolution.reason];
  const heading = recurred ? "New occurrence — investigation needs review"
    : closed ? `Resolved — ${reason}`
    : record.outcome === "resolved" ? `Previously resolved — ${reason}`
    : record.outcome === "pending-release" && reason ? `Awaiting production verification — ${reason}`
    : record.outcome.replaceAll("-", " ");
  return <section className="space-y-2 rounded-md border border-border p-3 text-sm" aria-label="Investigation">
    <p className="font-semibold">{heading}</p>
    <p>{record.finding}</p>
    {record.resolution && <p><strong>Impact:</strong> {record.resolution.impactAssessment}</p>}
    {closed && <p><strong>Remaining uncertainty:</strong> {record.missingEvidence}</p>}
    {!closed && <>
      <p><strong>Next action:</strong> {record.nextAction}</p>
      <p><strong>Evidence collection:</strong> {record.collector.expectedEvidence} ({record.collector.state})</p>
      <p><strong>Owner:</strong> {record.owner} · <strong>Review:</strong> {new Date(record.reviewAfter).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</p>
    </>}
  </section>;
}
