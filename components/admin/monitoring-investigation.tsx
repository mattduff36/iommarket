import { readInvestigation } from "@/lib/monitoring/investigation";

export function MonitoringInvestigation({ value, lastSeenAt }: { value: unknown; lastSeenAt: Date | string }) {
  const record = readInvestigation(value);
  if (!record) return <p className="text-sm text-text-secondary">Investigation record required: no structured evidence plan has been recorded.</p>;
  const recurred = record.observedLastSeenAt && new Date(lastSeenAt).getTime() > Date.parse(record.observedLastSeenAt);
  return <section className="space-y-2 rounded-md border border-border p-3 text-sm" aria-label="Investigation">
    <p className="font-semibold">{recurred ? "New occurrence — investigation needs review" : record.outcome.replaceAll("-", " ")}</p>
    <p>{record.finding}</p>
    <p><strong>Next action:</strong> {record.nextAction}</p>
    <p><strong>Evidence collection:</strong> {record.collector.expectedEvidence} ({record.collector.state})</p>
    <p><strong>Owner:</strong> {record.owner} · <strong>Review:</strong> {new Date(record.reviewAfter).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</p>
  </section>;
}
