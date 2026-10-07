import { describe, expect, it } from "vitest";
import { fetchOpenIssueSnapshot } from "@/scripts/fixerrors/snapshot";
import { EVENTS_PER_ISSUE, type PgClientLike } from "@/scripts/fixerrors/types";

const issues = ["issue-a", "issue-b"].map((id) => ({
  id,
  fingerprint: `fingerprint-${id}`,
  title: `Issue ${id}`,
  status: "OPEN",
  severity: "HIGH",
  source: "SERVER",
  lastSeenAt: new Date("2026-10-07T12:00:00.000Z"),
  occurrences: 20,
  sampleMessage: "Failure",
  sampleRoute: "/test",
  sampleAction: null,
  sampleComponent: null,
}));

function makeEvent(issueId: string, sequence: number): {
  id: string; issueId: string; source: string; severity: string; environment: string;
  message: string; stack: null; route: string; action: null; component: null;
  requestPath: string; occurredAt: Date; digest?: string; traceId?: string;
} {
  return {
    id: `${issueId}-${sequence}`,
    issueId,
    source: "SERVER",
    severity: "HIGH",
    environment: "production",
    message: `Failure ${sequence}`,
    stack: null,
    route: "/test",
    action: null,
    component: null,
    requestPath: "/test",
    occurredAt: new Date(Date.UTC(2026, 9, 7, 12, 0, sequence)),
  };
}

class SnapshotClient implements PgClientLike {
  calls: Array<{ text: string; values: unknown[] }> = [];
  events = issues.flatMap((issue) => Array.from({ length: 15 }, (_, sequence) => makeEvent(issue.id, sequence)));

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.calls.push({ text, values });
    if (text.startsWith("BEGIN") || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [] as T[], rowCount: 0 };
    }
    if (text.includes('FROM "MonitoringIssue"')) {
      return { rows: issues as unknown as T[], rowCount: issues.length };
    }
    if (text.includes('FROM "MonitoringEvent"')) {
      const requested = new Set((values[0] as string[]) ?? []);
      const limit = Number(values[1]);
      const rows = [...requested].flatMap((issueId) =>
        this.events
          .filter((event) => event.issueId === issueId)
          .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
          .slice(0, limit),
      );
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    throw new Error(`Unexpected query in snapshot test: ${text}`);
  }
}

describe("fixerrors event snapshot limits", () => {
  it("asks PostgreSQL for only the newest ten events per issue", async () => {
    const client = new SnapshotClient();
    const snapshot = await fetchOpenIssueSnapshot(client, "a".repeat(64), new Date("2026-10-08T00:00:00.000Z"));
    const eventQuery = client.calls.find((call) => call.text.includes('FROM "MonitoringEvent"'));

    expect(eventQuery?.text).toMatch(/row_number\(\) OVER \(PARTITION BY "issueId" ORDER BY "occurredAt" DESC, id DESC\)/i);
    expect(eventQuery?.text).toMatch(/WHERE issue_event_rank <= \$2/i);
    expect(eventQuery?.values[1]).toBe(EVENTS_PER_ISSUE);
    expect(snapshot.issues.map((issue) => issue.events)).toHaveLength(2);
    for (const issue of snapshot.issues) {
      expect(issue.events).toHaveLength(EVENTS_PER_ISSUE);
      expect(issue.events[0]?.id).toBe(`${issue.id}-14`);
      expect(issue.events.at(-1)?.id).toBe(`${issue.id}-5`);
    }
  });

  it("selects only allowlisted digest/trace correlation fields and drops unsafe values", async () => {
    const client = new SnapshotClient();
    client.events[14] = { ...client.events[14]!, digest: "digest-441", traceId: "iad1::trace_123" };
    client.events[13] = { ...client.events[13]!, digest: "unsafe value", traceId: "trace\nvalue" };
    const snapshot = await fetchOpenIssueSnapshot(client, "a".repeat(64));
    const eventQuery = client.calls.find((call) => call.text.includes('FROM "MonitoringEvent"'));
    const serialized = JSON.stringify(snapshot);

    expect(eventQuery?.text).toContain("tags->>'digest' AS digest");
    expect(eventQuery?.text).toContain("tags->>'traceId' AS \"traceId\"");
    expect(serialized).toContain('"digest":"digest-441"');
    expect(serialized).toContain('"traceId":"iad1::trace_123"');
    expect(serialized).not.toContain("unsafe value");
    expect(serialized).not.toContain("trace\\nvalue");
    expect(serialized).not.toContain('"tags"');
  });
});
