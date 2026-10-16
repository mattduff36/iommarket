import { execFileSync } from "node:child_process";
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
  requestPath: string; occurredAt: Date | string; digest?: string; traceId?: string;
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

function eventMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

class SnapshotClient implements PgClientLike {
  calls: Array<{ text: string; values: unknown[] }> = [];
  events = issues.flatMap((issue) => Array.from({ length: 15 }, (_, sequence) => makeEvent(issue.id, sequence)));

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.calls.push({ text, values });
    if (text.startsWith("BEGIN") || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [] as T[], rowCount: 0 };
    }
    if (text.includes("GROUP BY status")) {
      return {
        rows: [
          { status: "OPEN", count: 2 },
          { status: "ACKNOWLEDGED", count: 4 },
          { status: "MUTED", count: 1 },
          { status: "RESOLVED", count: 9 },
        ] as unknown as T[],
        rowCount: 4,
      };
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
          .sort((left, right) => eventMillis(right.occurredAt) - eventMillis(left.occurredAt))
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

  it("serializes occurredAt as UTC text and counts non-OPEN statuses without exporting them", async () => {
    const utcText = "2026-08-16T13:00:00.123456Z";
    const client = new SnapshotClient();
    client.events = [makeEvent("issue-a", 1), makeEvent("issue-b", 1)];
    client.events[0] = { ...client.events[0]!, occurredAt: utcText };
    const snapshot = await fetchOpenIssueSnapshot(client, "b".repeat(64));
    const eventQuery = client.calls.find((call) => call.text.includes('FROM "MonitoringEvent"'));
    const countQuery = client.calls.find((call) => call.text.includes("GROUP BY status"));
    // Reproduce pg's old timestamp parser in a guaranteed non-UTC process,
    // regardless of the timezone of the machine running this test suite.
    const localShift = execFileSync(process.execPath, ["-e",
      `process.stdout.write(require('pg').types.getTypeParser(1114)('2026-08-16 13:00:00.123456').toISOString())`,
    ], { env: { ...process.env, TZ: "Europe/London" }, encoding: "utf8" });

    expect(eventQuery?.text).toContain(
      `to_char("occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"`,
    );
    // These columns store UTC as timestamp without time zone. AT TIME ZONE
    // would introduce session-timezone-dependent formatting before adding Z.
    expect(eventQuery?.text).not.toContain("AT TIME ZONE");
    expect(client.calls.find((call) => call.text.includes("WHERE status = 'OPEN'"))?.text).not.toContain("AT TIME ZONE");
    expect(eventQuery?.text).toContain(`ORDER BY "issueId", ranked_events."occurredAt" DESC, id DESC`);
    expect(eventQuery?.text).toMatch(/row_number\(\) OVER \(PARTITION BY "issueId" ORDER BY "occurredAt" DESC, id DESC\)/i);
    expect(snapshot.issues[0]?.events[0]?.occurredAt).toBe(utcText);
    expect(new Date(utcText).toISOString()).toBe("2026-08-16T13:00:00.123Z");
    expect(localShift).toBe("2026-08-16T12:00:00.123Z");
    expect(utcText.startsWith(localShift.slice(0, 19))).toBe(false);
    expect(countQuery?.text).toContain('FROM "MonitoringIssue"');
    expect(countQuery?.text).not.toContain("WHERE status = 'OPEN'");
    expect(client.calls.some((call) => call.text.startsWith("BEGIN") && call.text.includes("READ ONLY"))).toBe(true);
    expect(snapshot.issues.map((issue) => issue.status)).toEqual(["OPEN", "OPEN"]);
    expect(snapshot.queueStatusCounts).toEqual({ OPEN: 2, ACKNOWLEDGED: 4, MUTED: 1, RESOLVED: 9 });
  });
});
