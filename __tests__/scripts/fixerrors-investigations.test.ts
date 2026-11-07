import { describe, expect, it, vi } from "vitest";
import { investigationSchema } from "@/lib/monitoring/investigation";
import { recordInvestigations } from "@/scripts/fixerrors/investigations";
import { sealSnapshot } from "@/scripts/fixerrors/snapshot";
import { FIXERRORS_COMMAND_ID, FIXERRORS_SAFETY_CONTRACT, FIXERRORS_SNAPSHOT_VERSION, type PgClientLike } from "@/scripts/fixerrors/types";
const record = { outcome: "collecting-evidence" as const, finding: "Historical request failure lacks response status.", evidence: ["Stored event contains no request correlation."], missingEvidence: "Request status and release are missing.", owner: "Engineering", nextAction: "Inspect the next correlated failed request.", reviewAfter: "2026-12-01T00:00:00.000Z", collector: { paths: ["lib/monitoring/request-diagnostics.ts"], tests: ["__tests__/lib/monitoring-request-diagnostics.test.ts"], trigger: "The next request failure on this route.", expectedEvidence: "Safe route, status, duration and request reference.", state: "ready" as const } };
const issue = { id: "issue-1", fingerprint: "fp-1", status: "ACKNOWLEDGED" as const, severity: "HIGH", source: "CLIENT", title: "Load failed", lastSeenAt: "2026-10-01T00:00:00.000000Z", occurrences: 1, sampleMessage: "Load failed", sampleRoute: "/search", sampleAction: null, sampleComponent: null, events: [] };
const snapshot = sealSnapshot({ version: FIXERRORS_SNAPSHOT_VERSION, commandId: FIXERRORS_COMMAND_ID, safetyContract: FIXERRORS_SAFETY_CONTRACT, snapshotId: "11111111-1111-4111-8111-111111111111", databaseTargetFingerprint: "a".repeat(64), exportedAt: "2026-11-07T00:00:00.000Z", expiresAt: "2026-11-08T00:00:00.000Z", issues: [issue], analysis: { status: "pending", reportPath: "private/fixerrors/error-analysis.md", reportChecksum: null, completedAt: null, clusterCount: 0, clusterLanes: {}, reportOnlyIssueIds: [], codeBaseline: null } });
function input(changed = false) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [{ ...issue, occurrences: changed ? 2 : 1 }] : [], rowCount: 1 }));
  return { client: { query } as unknown as PgClientLike, snapshot, databaseTargetFingerprint: "a".repeat(64), actorAdminId: "admin", entries: [{ issueId: issue.id, investigation: record }], apply: false, now: new Date("2026-11-07T00:10:00Z"), verifyCollector: vi.fn().mockResolvedValue(true), query };
}
describe("structured investigations", () => {
  it("rejects expiry without deployed collection, private text and traversal", () => {
    expect(investigationSchema.safeParse({ ...record, outcome: "expired" }).success).toBe(false);
    expect(investigationSchema.safeParse({ ...record, finding: "Contact person@example.com for evidence" }).success).toBe(false);
    expect(investigationSchema.safeParse({ ...record, collector: { ...record.collector, tests: ["__tests__/../secret.test.ts"] } }).success).toBe(false);
  });
  it("dry-runs acknowledged issues without changing them", async () => {
    const args = input(); const result = await recordInvestigations(args);
    expect(result.applied).toBe(false); expect(result.results[0]?.status).toBe("ACKNOWLEDGED");
    expect(args.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(args.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("rejects incomplete coverage and concurrent recurrence atomically", async () => {
    await expect(recordInvestigations({ ...input(), entries: [] })).rejects.toThrow();
    const args = input(true); await expect(recordInvestigations({ ...args, apply: true })).rejects.toThrow(/changed/);
    expect(args.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(args.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("requires verified collector deployment and rejects expiry of recent issues", async () => {
    const args = input(); const investigation = { ...record, outcome: "expired" as const, collector: { ...record.collector, state: "deployed" as const, deploymentSha: "b".repeat(40) } };
    await expect(recordInvestigations({ ...args, entries: [{ issueId: issue.id, investigation }], verifyCollector: vi.fn().mockResolvedValue(false) })).rejects.toThrow(/deployment/);
    const recent = sealSnapshot({ ...snapshot, issues: [{ ...issue, lastSeenAt: "2026-11-06T00:00:00.000Z" }] });
    await expect(recordInvestigations({ ...args, snapshot: recent, entries: [{ issueId: issue.id, investigation }] })).rejects.toThrow(/Recent/);
  });
  it("stores a bounded evidence bundle and audited outcome on apply", async () => {
    const args = input(); expect((await recordInvestigations({ ...args, apply: true })).applied).toBe(true);
    expect(args.query.mock.calls.some(([sql]) => sql.includes('UPDATE "MonitoringIssue"'))).toBe(true);
    expect(args.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO "AdminAuditLog"'))).toBe(true);
    expect(args.query).toHaveBeenLastCalledWith("COMMIT");
  });
});
