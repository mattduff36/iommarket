import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSnapshotIssueIds, parseFixerrorsInvocation } from "@/scripts/fixerrors";
import { acknowledgeSnapshotIssues } from "@/scripts/fixerrors/acknowledge";
import { formatSnapshotBinding } from "@/scripts/fixerrors/binding";
import { closeSnapshotIssues, FIXERRORS_MUTE_HOURS, parseCloseManifest } from "@/scripts/fixerrors/close-out";
import { createDatabaseTargetFingerprint, requireNonPoolingConnectionString } from "@/scripts/fixerrors/env";
import { fetchReleaseRefs, originRepository } from "@/scripts/fixerrors/git-policy";
import {
  assessProductionRelease,
  clusterFingerprint,
  parseVercelProductionStatus,
  readVercelProductionStatus,
  sealReleaseManifest,
  verifyProductionRelease,
  type ReleaseManifest,
} from "@/scripts/fixerrors/release";
import { decideIssueResolution, reopenResolvedByRun, resolveSnapshotIssues } from "@/scripts/fixerrors/resolve";
import {
  assertSnapshotUsable,
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
      codeBaseline: null,
    },
  });
}

class FakePg implements PgClientLike {
  queries: string[] = [];
  calls: Array<{ text: string; values: unknown[] }> = [];
  issues = new Map<string, Omit<SnapshotIssue, "status"> & { status: string; resolvedAt?: string | null }>();
  statusEvents: Array<{
    issueId: string;
    fromStatus?: string;
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
    this.calls.push({ text, values });
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
            severity: issue!.severity,
            lastSeenAt: issue!.lastSeenAt,
            occurrences: issue!.occurrences,
          })) as unknown as T[],
        rowCount: ids.length,
      };
    }
    if (text.startsWith("UPDATE") && text.includes("SET status = 'RESOLVED'")) {
      const id = String(values[0]);
      const issue = this.issues.get(id);
      if (!issue || (issue.status !== "OPEN" && issue.status !== "ACKNOWLEDGED")) {
        return { rows: [] as T[], rowCount: 0 };
      }
      issue.status = "RESOLVED";
      issue.resolvedAt = new Date().toISOString();
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.startsWith("UPDATE") && text.includes("SET status = 'ACKNOWLEDGED'")) {
      const id = String(values[0]);
      const issue = this.issues.get(id);
      const allowed = text.includes("IN ('OPEN', 'ACKNOWLEDGED')") ? ["OPEN", "ACKNOWLEDGED"] : ["OPEN"];
      if (!issue || !allowed.includes(issue.status)) return { rows: [] as T[], rowCount: 0 };
      issue.status = "ACKNOWLEDGED";
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.startsWith("UPDATE") && text.includes("SET status = 'MUTED'")) {
      const id = String(values[0]);
      const issue = this.issues.get(id);
      if (!issue || !["OPEN", "ACKNOWLEDGED", "MUTED"].includes(issue.status)) {
        return { rows: [] as T[], rowCount: 0 };
      }
      issue.status = "MUTED";
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
        fromStatus: String(values[2]),
        toStatus: String(values[3]),
        notes: String(values[4]),
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
      const legacy = sealSnapshot({
        ...snapshot,
        safetyContract: "fixerrors-open-issues-v1",
      });
      expect(() => verifySnapshot(legacy)).toThrow(/safety contract/);
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
      ).decision,
    ).toBe("would-resolve");
    expect(
      decideIssueResolution(
        snapshotIssue,
        {
          ...snapshotIssue,
          lastSeenAt: "2026-08-16T12:00:00.012346Z",
        },
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

  it("resolves an acknowledged issue, including one previously classified report-only", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    client.issues.get(issue.id)!.status = "ACKNOWLEDGED";
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
      evidence: "tightened the client error filter",
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });
    expect(result.results[0]?.decision).toBe("resolved");
    expect(client.issues.get(issue.id)?.status).toBe("RESOLVED");
    expect(client.statusEvents[0]).toMatchObject({ fromStatus: "ACKNOWLEDGED", toStatus: "RESOLVED" });
  });

  it("does not resolve an acknowledged issue that changed after export", () => {
    const snapshotIssue = makeIssue();
    const decision = decideIssueResolution(snapshotIssue, {
      ...snapshotIssue,
      status: "ACKNOWLEDGED",
      occurrences: 9,
    });
    expect(decision.decision).toBe("skipped-stale");
  });
});

describe("FIX-REPORT-ONLY-001 generated resolution selection", () => {
  it("includes every snapshot issue because classification does not block resolution", () => {
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

    expect(getSnapshotIssueIds(signed)).toEqual([codeIssue.id, externalIssue.id]);
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

describe("FIX-ACKNOWLEDGE-001 snapshot acknowledgement", () => {
  it("acknowledges unchanged OPEN issues and leaves changed issues OPEN", async () => {
    const stable = makeIssue({ id: "stable" });
    const changed = makeIssue({ id: "changed", fingerprint: "fp-changed" });
    const client = new FakePg([stable, changed]);
    client.issues.get("changed")!.occurrences = 9;
    const snapshot = makeSnapshot([stable, changed]);
    const result = await acknowledgeSnapshotIssues({
      client,
      snapshot,
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
    });

    expect(result.results.find((entry) => entry.issueId === "stable")?.decision).toBe("acknowledged");
    expect(result.results.find((entry) => entry.issueId === "changed")?.decision).toBe("skipped-stale");
    expect(client.issues.get("stable")?.status).toBe("ACKNOWLEDGED");
    expect(client.issues.get("changed")?.status).toBe("OPEN");
    expect(client.statusEvents[0]?.notes).toBe("fixerrors acknowledged for investigation");
  });
});

describe("FIX-CLOSE-001 close-out", () => {
  it("requires a next step and rejects an incomplete manifest", () => {
    expect(() => parseCloseManifest({
      issues: [{ issueId: "issue-1", outcome: "acknowledged" }],
    }, ["issue-1"])).toThrow(/Next step/);
    expect(() => parseCloseManifest({
      issues: [{ issueId: "issue-1", outcome: "muted", nextStep: "Expected validation noise" }],
    }, ["issue-1", "issue-2"])).toThrow(/every snapshot issue/);
  });

  it("keeps a fix pending release, records follow-up, mutes noise, and writes the summary", async () => {
    const fixed = makeIssue({ id: "fixed" });
    const followUp = makeIssue({ id: "follow-up", fingerprint: "fp-follow" });
    const noise = makeIssue({ id: "noise", fingerprint: "fp-noise" });
    const changed = makeIssue({ id: "changed", fingerprint: "fp-changed" });
    const client = new FakePg([fixed, followUp, noise, changed]);
    for (const issue of [fixed, followUp, noise, changed]) {
      client.issues.get(issue.id)!.status = "ACKNOWLEDGED";
    }
    client.issues.get("changed")!.occurrences = 8;
    const snapshot = makeSnapshot([fixed, followUp, noise, changed]);
    const now = new Date("2026-08-16T12:00:00.000Z");
    const dir = mkdtempSync(join(tmpdir(), "fxmon-close-"));
    const summaryPath = join(dir, "summary.md");
    try {
      const result = await closeSnapshotIssues({
        client,
        snapshot,
        now,
        summaryPath,
        apply: true,
        databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
        actorAdminId: "admin-1",
        entries: [
          { issueId: "fixed", outcome: "pending-release", nextStep: "Push staging, merge to main, then verify the production deployment." },
          { issueId: "follow-up", outcome: "acknowledged", nextStep: "Ask the provider to retry the webhook." },
          { issueId: "noise", outcome: "muted", nextStep: "Expected validation noise. Re-triage after mute expiry." },
          { issueId: "changed", outcome: "acknowledged", nextStep: "Re-export because the issue recurred during the run." },
        ],
      });

      expect(result.applied).toBe(true);
      expect(client.issues.get("fixed")?.status).toBe("ACKNOWLEDGED");
      expect(client.issues.get("follow-up")?.status).toBe("ACKNOWLEDGED");
      expect(client.issues.get("noise")?.status).toBe("MUTED");
      expect(client.issues.get("changed")?.status).toBe("ACKNOWLEDGED");
      const muteCall = client.calls.find((call) => call.text.includes("SET status = 'MUTED'"));
      expect(muteCall?.values[1]).toEqual(new Date(now.getTime() + FIXERRORS_MUTE_HOURS * 60 * 60 * 1000));
      const summary = readFileSync(summaryPath, "utf8");
      expect(summary).toContain("## Pending release");
      expect(summary).toContain("Push staging, merge to main, then verify the production deployment.");
      expect(summary).toContain("Expected validation noise. Re-triage after mute expiry.");
      expect(summary).toContain("Re-export because the issue recurred during the run.");
      expect(summary).toContain("## Changed during the run");
      expect(client.statusEvents.find((event) => event.issueId === "follow-up")?.notes).toBe(
        "Ask the provider to retry the webhook.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a close-out that tries to resolve before production deployment", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    client.issues.get(issue.id)!.status = "ACKNOWLEDGED";
    const snapshot = makeSnapshot([issue]);
    await expect(closeSnapshotIssues({
      client,
      snapshot,
      apply: true,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      actorAdminId: "admin-1",
      entries: [{ issueId: issue.id, outcome: "resolved" as never, evidence: "too late" }],
    })).rejects.toThrow(/production deployment/);
    expect(client.committed).toBe(false);
    expect(client.issues.get(issue.id)?.status).toBe("ACKNOWLEDGED");
  });
});

const MAIN_SHA = "a".repeat(40);
const STAGING_SHA = "b".repeat(40);
const FIX_SHA = "c".repeat(40);

function releaseGit(contained: { staging?: boolean; main?: boolean } = {}) {
  const onStaging = contained.staging ?? true;
  const onMain = contained.main ?? true;
  return (args: string[]) => {
    if (args[0] === "fetch") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "origin/main") return { status: 0, stdout: `${MAIN_SHA}\n`, stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "origin/staging") return { status: 0, stdout: `${STAGING_SHA}\n`, stderr: "" };
    if (args[0] === "merge-base") {
      const ancestor = args[2];
      const descendant = args[3];
      const ok = ancestor === FIX_SHA && (
        (descendant === "origin/staging" && onStaging) || (descendant === "origin/main" && onMain)
      );
      return { status: ok ? 0 : 1, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };
}

function deployedStatus(sha = MAIN_SHA) {
  return {
    ok: true as const,
    sha,
    completedAt: "2026-08-16T13:00:00.000Z",
    targetUrl: "https://vercel.com/iommarket/deployments/abc",
  };
}

function releaseManifest(snapshot: OpenIssueSnapshot, issue: SnapshotIssue): ReleaseManifest {
  return sealReleaseManifest({
    version: 1,
    safetyContract: FIXERRORS_SAFETY_CONTRACT,
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.checksum,
    clusterId: "cluster-1",
    issueIds: [issue.id],
    issueFingerprints: [issue.fingerprint],
    clusterFingerprint: clusterFingerprint([issue.fingerprint]),
    productionSha: MAIN_SHA,
    stagingSha: STAGING_SHA,
    fixCommitSha: FIX_SHA,
    paths: ["lib/monitoring/alerts.ts"],
    postFixBlobs: { "lib/monitoring/alerts.ts": "d".repeat(40) },
    tests: ["vitest"],
    evidence: "reviewed alert retry",
  });
}

describe("FIX-RELEASE production deployment gate", () => {
  it("parses the printed snapshot binding without treating the fingerprint as a database", () => {
    const snapshot = makeSnapshot([makeIssue()]);
    const binding = formatSnapshotBinding(snapshot).split(" ");
    const acknowledged = parseFixerrorsInvocation(["--acknowledge", ...binding]);
    const closed = parseFixerrorsInvocation(["--close", "--close-manifest=private/fixerrors/close.json", ...binding]);
    expect(acknowledged.database).toBe("production");
    expect(closed.database).toBe("production");
    expect(acknowledged.binding?.databaseTargetFingerprint).toBe(snapshot.databaseTargetFingerprint);
    expect(closed.binding).toEqual(acknowledged.binding);
    expect(acknowledged.binding?.safetyContract).toBe(FIXERRORS_SAFETY_CONTRACT);
    expect(() => parseFixerrorsInvocation(["--resolve"])).toThrow(/production deployment/);
  });

  it("requires a completed Vercel deployment for the exact origin/main commit", async () => {
    const payload = {
      sha: MAIN_SHA,
      statuses: [{
        context: "Vercel",
        state: "success",
        description: "Deployment has completed",
        target_url: "https://vercel.com/iommarket/deployments/abc",
        updated_at: "2026-08-16T13:00:00.000Z",
      }],
    };
    expect(parseVercelProductionStatus(payload, MAIN_SHA)).toMatchObject({ ok: true, sha: MAIN_SHA });
    expect(parseVercelProductionStatus({ ...payload, sha: STAGING_SHA }, MAIN_SHA)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/origin\/main/),
    });
    expect(parseVercelProductionStatus({
      ...payload,
      statuses: [{ ...payload.statuses[0], state: "pending" }],
    }, MAIN_SHA)).toMatchObject({ ok: false, reason: expect.stringMatching(/pending/) });
    expect(parseVercelProductionStatus({
      ...payload,
      statuses: [{ ...payload.statuses[0], state: "failure" }],
    }, MAIN_SHA)).toMatchObject({ ok: false, reason: expect.stringMatching(/did not succeed/) });
    expect(parseVercelProductionStatus({ ...payload, statuses: [] }, MAIN_SHA)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/missing/),
    });
    expect(parseVercelProductionStatus({
      ...payload,
      statuses: [{ ...payload.statuses[0], target_url: "https://example.com/deploy" }],
    }, MAIN_SHA)).toMatchObject({ ok: false, reason: expect.stringMatching(/URL/) });
    await expect(readVercelProductionStatus({
      owner: "mattduff36",
      repo: "iommarket",
      sha: MAIN_SHA,
      run: () => ({ status: 1, stdout: "token gh-secret" }),
    })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/authentication/) });
    expect(originRepository("git@github.com:mattduff36/iommarket.git")).toEqual({ owner: "mattduff36", repo: "iommarket" });
    expect(() => originRepository("https://gitlab.com/mattduff36/iommarket")).toThrow(/GitHub/);
    expect(() => fetchReleaseRefs(process.cwd(), () => ({ status: 1, stdout: "", stderr: "" }))).toThrow(/fetch/);
  });

  it("resolves a pre-deploy recurrence and leaves a post-deploy recurrence acknowledged", async () => {
    const before = makeIssue({ lastSeenAt: deployedStatus().completedAt });
    const beforeClient = new FakePg([before]);
    beforeClient.issues.get(before.id)!.status = "ACKNOWLEDGED";
    beforeClient.issues.get(before.id)!.occurrences = 9;
    const beforeSnapshot = makeSnapshot([before]);
    const expired = sealSnapshot({ ...beforeSnapshot, expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(() => assertSnapshotUsable(expired, expired.databaseTargetFingerprint, new Date())).toThrow(/expired/);
    const resolved = await verifyProductionRelease({
      client: beforeClient,
      snapshot: expired,
      manifest: releaseManifest(expired, before),
      databaseTargetFingerprint: expired.databaseTargetFingerprint,
      apply: true,
      actorAdminId: "admin-1",
      runGit: releaseGit(),
      deployment: deployedStatus(),
    });
    expect(resolved).toMatchObject({ ok: true, applied: true, resolvable: [before.id], recurred: [] });
    expect(beforeClient.issues.get(before.id)?.status).toBe("RESOLVED");

    const after = makeIssue({ lastSeenAt: "2026-08-16T14:00:00.000Z" });
    const afterClient = new FakePg([after]);
    afterClient.issues.get(after.id)!.status = "ACKNOWLEDGED";
    const afterSnapshot = makeSnapshot([after]);
    const recurred = await verifyProductionRelease({
      client: afterClient,
      snapshot: afterSnapshot,
      manifest: releaseManifest(afterSnapshot, after),
      databaseTargetFingerprint: afterSnapshot.databaseTargetFingerprint,
      apply: true,
      actorAdminId: "admin-1",
      runGit: releaseGit(),
      deployment: deployedStatus(),
    });
    expect(recurred).toMatchObject({ ok: true, applied: true, resolvable: [], recurred: [after.id] });
    expect(afterClient.issues.get(after.id)?.status).toBe("ACKNOWLEDGED");
    expect(afterClient.statusEvents[0]?.notes).toMatch(/recurred after the production deployment/);
  });

  it("fails closed when the fix is not on main, Vercel is unverified, or the manifest is tampered", async () => {
    const issue = makeIssue();
    const client = new FakePg([issue]);
    client.issues.get(issue.id)!.status = "ACKNOWLEDGED";
    const snapshot = makeSnapshot([issue]);
    const manifest = releaseManifest(snapshot, issue);
    const blocked = await verifyProductionRelease({
      client,
      snapshot,
      manifest,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      apply: true,
      actorAdminId: "admin-1",
      runGit: releaseGit({ main: false }),
      deployment: deployedStatus(),
    });
    expect(blocked.reason).toMatch(/origin\/main/);
    expect(client.queries.some((query) => query.startsWith("BEGIN"))).toBe(false);
    expect(client.issues.get(issue.id)?.status).toBe("ACKNOWLEDGED");

    const unverified = await verifyProductionRelease({
      client,
      snapshot,
      manifest,
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      apply: true,
      actorAdminId: "admin-1",
      runGit: releaseGit(),
      deployment: { ok: false, reason: "GitHub authentication failed or the Vercel status could not be read" },
    });
    expect(unverified.reason).toMatch(/authentication/);
    expect(client.issues.get(issue.id)?.status).toBe("ACKNOWLEDGED");

    const newer = assessProductionRelease({
      manifest,
      containedByStaging: true,
      containedByMain: true,
      mainSha: MAIN_SHA,
      vercel: deployedStatus("e".repeat(40)),
      issues: [{ issueId: issue.id, fingerprint: issue.fingerprint, lastSeenAt: issue.lastSeenAt, status: "ACKNOWLEDGED" }],
    });
    expect(newer).toMatchObject({ ok: false, reason: expect.stringMatching(/newer origin\/main/) });
    await expect(verifyProductionRelease({
      client,
      snapshot,
      manifest: { ...manifest, evidence: "tampered" },
      databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
      apply: false,
      actorAdminId: "admin-1",
      runGit: releaseGit(),
      deployment: deployedStatus(),
    })).rejects.toThrow(/checksum/);
  });
});
