import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getResolvableSnapshotIssueIds } from "@/scripts/fixerrors";
import { createDatabaseTargetFingerprint, requireNonPoolingConnectionString } from "@/scripts/fixerrors/env";
import { decideIssueResolution, reopenResolvedByRun, resolveSnapshotIssues } from "@/scripts/fixerrors/resolve";
import {
  fetchOpenIssueSnapshot,
  sealSnapshot,
  verifySnapshot,
  writeAndVerifySnapshot,
} from "@/scripts/fixerrors/snapshot";
import {
  FIXERRORS_COMMAND_ID,
  FIXERRORS_SAFETY_CONTRACT,
  FIXERRORS_SNAPSHOT_VERSION,
  type OpenIssueSnapshot,
  type PgClientLike,
  type SnapshotIssue,
} from "@/scripts/fixerrors/types";

function makeIssue(overrides: Partial<SnapshotIssue> = {}): SnapshotIssue {
  return {
    id: "issue-1",
    fingerprint: "fp-1",
    title: "Boom",
    status: "OPEN",
    severity: "HIGH",
    source: "SERVER",
    lastSeenAt: "2026-08-16T12:00:00.000Z",
    occurrences: 2,
    sampleMessage: "Boom",
    sampleRoute: "/sell",
    sampleAction: "payForListing",
    sampleComponent: null,
    events: [],
    ...overrides,
  };
}

function makeSnapshot(issues: SnapshotIssue[], target = "a".repeat(64)): OpenIssueSnapshot {
  return sealSnapshot({
    version: FIXERRORS_SNAPSHOT_VERSION,
    commandId: FIXERRORS_COMMAND_ID,
    safetyContract: FIXERRORS_SAFETY_CONTRACT,
    snapshotId: "11111111-1111-4111-8111-111111111111",
    databaseTargetFingerprint: target,
    exportedAt: "2026-08-16T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    issues,
    analysis: {
      status: "completed",
      reportPath: "private/fixerrors/error-analysis.md",
      reportChecksum: "b".repeat(64),
      completedAt: "2026-08-16T12:00:00.000Z",
      clusterCount: 1,
      clusterLanes: { fast: 1 },
      reportOnlyIssueIds: [],
    },
  });
}

class FakePg implements PgClientLike {
  queries: string[] = [];
  issues = new Map<string, Omit<SnapshotIssue, "status"> & { status: string; resolvedAt?: string | null }>();
  statusEvents: Array<{
    issueId: string;
    toStatus: string;
    notes: string;
  }> = [];
  audits: Array<Record<string, unknown>> = [];
  failOn?: string;
  committed = false;
  rolledBack = false;

  constructor(issues: SnapshotIssue[] = []) {
    for (const issue of issues) this.issues.set(issue.id, { ...issue });
  }

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.queries.push(text);
    if (this.failOn && text.includes(this.failOn)) {
      throw new Error("forced failure");
    }
    if (text.startsWith("BEGIN") || text === "COMMIT" || text === "ROLLBACK") {
      if (text === "COMMIT") this.committed = true;
      if (text === "ROLLBACK") this.rolledBack = true;
      return { rows: [] as T[], rowCount: 0 };
    }
    if (text.includes('FROM "MonitoringIssue"') && text.includes("WHERE status = 'OPEN'")) {
      return {
        rows: [...this.issues.values()].filter((issue) => issue.status === "OPEN") as unknown as T[],
        rowCount: this.issues.size,
      };
    }
    if (text.includes('FROM "MonitoringEvent"')) {
      return { rows: [] as T[], rowCount: 0 };
    }
    if (text.includes("FOR UPDATE")) {
      const ids = (values[0] as string[]) ?? [];
      return {
        rows: ids
          .map((id) => this.issues.get(id))
          .filter(Boolean)
          .map((issue) => ({
            id: issue!.id,
            fingerprint: issue!.fingerprint,
            status: issue!.status,
            lastSeenAt: issue!.lastSeenAt,
            occurrences: issue!.occurrences,
          })) as unknown as T[],
        rowCount: ids.length,
      };
    }
    if (text.startsWith("UPDATE") && text.includes("SET status = 'RESOLVED'")) {
      const id = String(values[0]);
      const issue = this.issues.get(id);
      if (!issue || issue.status !== "OPEN") return { rows: [] as T[], rowCount: 0 };
      issue.status = "RESOLVED";
      issue.resolvedAt = new Date().toISOString();
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.startsWith("UPDATE") && text.includes("SET status = 'OPEN'")) {
      const id = String(values[0]);
      const issue = this.issues.get(id);
      if (!issue || issue.status !== "RESOLVED") return { rows: [] as T[], rowCount: 0 };
      issue.status = "OPEN";
      issue.resolvedAt = null;
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.includes("MonitoringIssueStatusEvent") && text.startsWith("INSERT")) {
      this.statusEvents.push({
        issueId: String(values[1]),
        toStatus: text.includes("'RESOLVED', 'OPEN'") ? "OPEN" : "RESOLVED",
        notes: String(values[2]),
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.includes("AdminAuditLog") && text.startsWith("INSERT")) {
      this.audits.push({ text, values });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.includes("MonitoringIssueStatusEvent") && text.includes("SELECT")) {
      const runMatch = String(values[0] ?? "").match(/run=([0-9a-f-]+)/i);
      const runId = runMatch?.[1] ?? "";
      const latestByIssue = new Map<string, (typeof this.statusEvents)[number]>();
      for (const event of this.statusEvents) latestByIssue.set(event.issueId, event);
      const rows = [...latestByIssue.values()]
        .filter(
          (event) =>
            event.toStatus === "RESOLVED" &&
            event.notes.startsWith(`fixerrors run=${runId} `),
        )
        .map((event) => ({ issueId: event.issueId }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (text.includes('FROM "User"')) {
      return { rows: [{ id: "admin-1" }] as unknown as T[], rowCount: 1 };
    }
    return { rows: [] as T[], rowCount: 0 };
  }
}

describe("FIX-DB-001 connection targeting", () => {
  it("requires POSTGRES_URL_NON_POOLING and fingerprints host/db only", () => {
    expect(() => requireNonPoolingConnectionString({})).toThrow(/POSTGRES_URL_NON_POOLING/);
    const fingerprint = createDatabaseTargetFingerprint(
      "postgresql://user:super-secret@db.example:5432/iommarket?sslmode=require",
    );
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).toBe(
      createDatabaseTargetFingerprint("postgresql://other:changed@db.example:5432/iommarket"),
    );
  });
});

describe("FXMON-SNAPSHOT-004 / FIX-SNAPSHOT export", () => {
  it("exports a repeatable-read checksum-bound OPEN snapshot", async () => {
    const client = new FakePg([
      makeIssue({ lastSeenAt: "2026-08-16T12:00:00.012345Z" }),
      makeIssue({ id: "closed", status: "RESOLVED" as never }),
    ]);
    const snapshot = await fetchOpenIssueSnapshot(client, "c".repeat(64));
    expect(client.queries[0]).toContain("REPEATABLE READ READ ONLY");
    expect(client.queries[1]).toContain("to_char");
    expect(snapshot.issues.map((issue) => issue.id)).toEqual(["issue-1"]);
    expect(snapshot.issues[0]?.lastSeenAt).toBe("2026-08-16T12:00:00.012345Z");
    expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySnapshot(snapshot).issues).toHaveLength(1);
  });
});

describe("FXMON-TARGET-005 artifact gates", () => {
  it("blocks wrong database, expired, corrupt, or mismatched artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxmon-snap-"));
    const path = join(dir, "snapshot.json");
    try {
      const snapshot = makeSnapshot([makeIssue()]);
      writeAndVerifySnapshot(snapshot, path);
      const raw = JSON.parse(readFileSync(path, "utf8")) as OpenIssueSnapshot;
      raw.issues[0]!.sampleMessage = "tampered";
      writeFileSync(path, JSON.stringify(raw));
      expect(() => verifySnapshot(raw)).toThrow(/checksum/);
      expect(() =>
        verifySnapshot({ ...snapshot, databaseTargetFingerprint: "d".repeat(64), checksum: snapshot.checksum }),
      ).toThrow(/checksum/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FXMON-STALE-006 / FIX-SNAPSHOT-001", () => {
  it("leaves a concurrently recurring issue OPEN", () => {
    const snapshotIssue = makeIssue();
    const decision = decideIssueResolution(
      snapshotIssue,
      { ...snapshotIssue, occurrences: 3 },
      new Set(),
    );
    expect(decision.decision).toBe("skipped-stale");
  });

  it("accepts an unchanged PostgreSQL Date without losing milliseconds", () => {
    const snapshotIssue = makeIssue({
      lastSeenAt: "2026-08-16T12:00:00.012Z",
    });
    const decision = decideIssueResolution(
      snapshotIssue,
      {
        ...snapshotIssue,
        lastSeenAt: new Date(snapshotIssue.lastSeenAt),
      },
      new Set(),
    );
    expect(decision.decision).toBe("would-resolve");
  });

  it("rejects a PostgreSQL Date that changed after the snapshot", () => {
    const snapshotIssue = makeIssue({
      lastSeenAt: "2026-08-16T12:00:00.012Z",
    });
    const decision = decideIssueResolution(
      snapshotIssue,
      {
        ...snapshotIssue,
        lastSeenAt: new Date("2026-08-16T12:00:00.013Z"),
      },
      new Set(),
    );
    expect(decision.decision).toBe("skipped-stale");
  });

  it("compares PostgreSQL microsecond strings exactly", () => {
    const snapshotIssue = makeIssue({
      lastSeenAt: "2026-08-16T12:00:00.012345Z",
    });
    expect(
      decideIssueResolution(
        snapshotIssue,
        { ...snapshotIssue },
        new Set(),
      ).decision,
    ).toBe("would-resolve");
    expect(
      decideIssueResolution(
        snapshotIssue,
        {
          ...snapshotIssue,
          lastSeenAt: "2026-08-16T12:00:00.012346Z",
        },
        new Set(),
      ).decision,
    ).toBe("skipped-stale");
  });
});

describe("FXMON-RESOLVE-007 / FIX-AUDIT-001", () => {
  it("resolves only selected unchanged rows and writes status plus audit records", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    const snapshot = makeSnapshot([issue], "e".repeat(64));
    const result = await resolveSnapshotIssues({
      client,
      snapshot,
      issueIds: [issue.id],
      evidence: "vitest passed",
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });
    expect(result.applied).toBe(true);
    expect(result.results[0]?.decision).toBe("resolved");
    expect(client.issues.get(issue.id)?.status).toBe("RESOLVED");
    expect(client.statusEvents).toHaveLength(1);
    expect(client.audits).toHaveLength(1);
    expect(client.issues.get(issue.id)?.events).toEqual([]);
  });

  it("cannot resolve an issue classified as report-only in the signed snapshot", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    const snapshot = sealSnapshot({
      ...makeSnapshot([issue], "e".repeat(64)),
      analysis: {
        ...makeSnapshot([issue], "e".repeat(64)).analysis,
        reportOnlyIssueIds: [issue.id],
      },
    });
    const result = await resolveSnapshotIssues({
      client,
      snapshot,
      issueIds: [issue.id],
      evidence: "investigated external failure",
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });
    expect(result.results[0]?.decision).toBe("report-only");
    expect(client.issues.get(issue.id)?.status).toBe("OPEN");
  });
});

describe("FIX-REPORT-ONLY-001 generated resolution selection", () => {
  it("omits signed report-only issue IDs from generated resolution selection", () => {
    const codeIssue = makeIssue({ id: "code-defect" });
    const externalIssue = makeIssue({ id: "external-failure" });
    const snapshot = makeSnapshot([codeIssue, externalIssue]);
    const signed = sealSnapshot({
      ...snapshot,
      analysis: {
        ...snapshot.analysis,
        reportOnlyIssueIds: [externalIssue.id],
      },
    });

    expect(getResolvableSnapshotIssueIds(signed)).toEqual([codeIssue.id]);
  });
});

describe("FXMON-ROLLBACK-008 transactional failure", () => {
  it("rolls back all status/event writes on any transactional failure", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    client.failOn = "AdminAuditLog";
    const snapshot = makeSnapshot([issue], "f".repeat(64));
    await expect(
      resolveSnapshotIssues({
        client,
        snapshot,
        issueIds: [issue.id],
        evidence: "vitest passed",
        apply: true,
        databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
        actorAdminId: "admin-1",
      }),
    ).rejects.toThrow("forced failure");
    expect(client.rolledBack).toBe(true);
    expect(client.committed).toBe(false);
  });
});

describe("FIX-ROLLBACK-001 reopen by run id", () => {
  it("reopens only issues resolved by the target run id", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    const snapshot = makeSnapshot([issue], "a".repeat(64));
    const resolved = await resolveSnapshotIssues({
      client,
      snapshot,
      issueIds: [issue.id],
      evidence: "vitest passed",
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });
    const reopened = await reopenResolvedByRun({
      client,
      runId: resolved.runId,
      apply: true,
      actorAdminId: "admin-1",
    });
    expect(reopened.applied).toBe(true);
    expect(client.issues.get(issue.id)?.status).toBe("OPEN");
  });

  it("rejects wildcard or non-UUID run identifiers", async () => {
    await expect(
      reopenResolvedByRun({
        client: new FakePg(),
        runId: "%",
        apply: true,
        actorAdminId: "admin-1",
      }),
    ).rejects.toThrow(/valid UUID/);
  });

  it("does not reopen when a later status event superseded the target run", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    const snapshot = makeSnapshot([issue]);
    const resolved = await resolveSnapshotIssues({
      client,
      snapshot,
      issueIds: [issue.id],
      evidence: "vitest passed",
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });
    client.statusEvents.push({
      issueId: issue.id,
      toStatus: "RESOLVED",
      notes: "manual resolution by an admin",
    });

    const reopened = await reopenResolvedByRun({
      client,
      runId: resolved.runId,
      apply: true,
      actorAdminId: "admin-1",
    });

    expect(reopened.results).toEqual([]);
    expect(client.issues.get(issue.id)?.status).toBe("RESOLVED");
  });
});
