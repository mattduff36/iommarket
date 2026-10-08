import { describe, expect, it } from "vitest";
import { sealSnapshot } from "@/scripts/fixerrors/snapshot";
import { reopenMutedByRun } from "@/scripts/fixerrors/unmute";
import { FIXERRORS_COMMAND_ID, FIXERRORS_SAFETY_CONTRACT, FIXERRORS_SNAPSHOT_VERSION, type PgClientLike, type SnapshotIssue } from "@/scripts/fixerrors/types";

const runId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";
const target = "a".repeat(64);
const instant = "2026-10-07T20:00:00.000Z";
const original: SnapshotIssue = {
  id: "issue-1", fingerprint: "fp-1", title: "Opaque error", status: "OPEN", severity: "HIGH",
  source: "CLIENT", lastSeenAt: instant, occurrences: 2, sampleMessage: "Script error",
  sampleRoute: null, sampleAction: null, sampleComponent: null, events: [],
};
const snapshot = sealSnapshot({
  version: FIXERRORS_SNAPSHOT_VERSION, commandId: FIXERRORS_COMMAND_ID,
  safetyContract: FIXERRORS_SAFETY_CONTRACT, snapshotId, databaseTargetFingerprint: target,
  exportedAt: instant, expiresAt: "2026-10-07T20:30:00.000Z", issues: [original],
  analysis: { status: "completed", reportPath: "private/fixerrors/error-analysis.md", reportChecksum: "b".repeat(64),
    completedAt: instant, clusterCount: 1, clusterLanes: { guarded: 1 }, reportOnlyIssueIds: [], codeBaseline: null },
});

class FakeDb implements PgClientLike {
  calls: string[] = [];
  status = "MUTED";
  fingerprint = original.fingerprint;
  occurrences = original.occurrences;
  auditRun = runId;
  eventTime = instant;
  updateCount = 1;
  async query<T extends Record<string, unknown>>(sql: string) {
    this.calls.push(sql);
    let rows: unknown[] = [];
    if (sql.includes("FOR UPDATE")) rows = [{ ...original, status: this.status, fingerprint: this.fingerprint, occurrences: this.occurrences }];
    if (sql.includes('FROM "AdminAuditLog"')) rows = [{ action: "FIXERRORS_MUTE_MONITORING_ISSUE", details: { runId: this.auditRun, snapshotId, nextStep: "Original mute note" }, createdAt: instant }];
    if (sql.includes('FROM "MonitoringIssueStatusEvent"')) rows = [{ toStatus: "MUTED", createdAt: this.eventTime, notes: "Original mute note" }];
    return { rows: rows as T[], rowCount: sql.startsWith('UPDATE "MonitoringIssue"') ? this.updateCount : rows.length };
  }
}
function invoke(client: FakeDb, apply = false) {
  return reopenMutedByRun({ client, snapshot, databaseTargetFingerprint: target, runId, issueIds: [original.id],
    evidence: "Opaque error is not proven noise; retain for investigation", actorAdminId: "admin-1", apply,
    now: new Date("2026-10-09T00:00:00Z") });
}

describe("audited mute correction", () => {
  it("dry-runs an unchanged historical mute without writing", async () => {
    const db = new FakeDb();
    expect(await invoke(db)).toMatchObject({ applied: false, outcome: "would-acknowledge" });
    expect(db.calls.at(-1)).toBe("ROLLBACK");
    expect(db.calls.some((sql) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it("acknowledges with status and admin audit evidence, never resolves", async () => {
    const db = new FakeDb();
    expect(await invoke(db, true)).toMatchObject({ applied: true, outcome: "acknowledged" });
    expect(db.calls.filter((sql) => sql.startsWith("INSERT"))).toHaveLength(2);
    expect(db.calls.at(-1)).toBe("COMMIT");
    expect(db.calls.find((sql) => sql.startsWith("UPDATE"))).toContain('"mutedUntil" = NULL');
  });
  it.each(["status", "fingerprint", "occurrences", "auditRun", "eventTime"] as const)("refuses changed %s", async (field) => {
    const db = new FakeDb();
    if (field === "occurrences") db.occurrences = 3;
    else db[field] = field === "eventTime" ? "2026-10-08T00:00:00Z" : "changed";
    await expect(invoke(db, true)).rejects.toThrow("Mute correction blocked");
    expect(db.calls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(db.calls.at(-1)).toBe("ROLLBACK");
  });
  it("rolls back a failed guarded update", async () => {
    const db = new FakeDb(); db.updateCount = 0;
    await expect(invoke(db, true)).rejects.toThrow("rolling back");
    expect(db.calls.at(-1)).toBe("ROLLBACK");
    expect(db.calls.some((sql) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("rejects another database and IDs outside the snapshot before starting", async () => {
    const db = new FakeDb();
    const base = { client: db, snapshot, databaseTargetFingerprint: target, runId, issueIds: [original.id], evidence: "Reviewed correction", actorAdminId: "admin", apply: true };
    await expect(reopenMutedByRun({ ...base, databaseTargetFingerprint: "wrong" })).rejects.toThrow("different database");
    await expect(reopenMutedByRun({ ...base, issueIds: ["other"] })).rejects.toThrow("absent");
    expect(db.calls).toHaveLength(0);
  });
});
