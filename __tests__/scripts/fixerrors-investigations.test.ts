import { describe, expect, it, vi } from "vitest";
import { investigationSchema } from "@/lib/monitoring/investigation";
import { createCollectorVerifier } from "@/scripts/fixerrors/collector-verification";
import { draftInvestigationManifest, recordInvestigations, reconcileInvestigationResolutions } from "@/scripts/fixerrors/investigations";
import { contentChecksum } from "@/scripts/fixerrors/integrity";
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
  const resolution = { reason: "unable-to-reproduce" as const, impact: "low" as const,
    impactAssessment: "The isolated report had no lasting effect and current controls passed.", seriousOrContinuing: false as const };
  const pending = { ...record, outcome: "pending-release" as const,
    resolution: { ...resolution, reason: "diagnostics-improved" as const, candidateSha: "b".repeat(40) },
    observedOccurrences: issue.occurrences, observedLastSeenAt: issue.lastSeenAt };

  it("resolves reviewed low-impact follow-up without asserting a fix", async () => {
    const args = input();
    const result = await recordInvestigations({ ...args, apply: true, entries: [
      { issueId: issue.id, investigation: { ...record, outcome: "resolved", resolution } },
    ] });
    expect(result.results[0]?.status).toBe("RESOLVED");
    expect(args.query.mock.calls.flat().join(" ")).toContain("Reviewed — unable to reproduce");
    expect(args.verifyCollector).not.toHaveBeenCalled();
  });

  it("requires verified production evidence before automatically closing a diagnostic improvement", async () => {
    const args = input();
    const saved = sealSnapshot({ ...snapshot, issues: [{ ...issue, investigation: pending }] });
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [{ ...issue, investigation: pending }] : [], rowCount: 1 }));
    const reconciliation = { ...args, snapshot: saved, apply: true, productionSha: "c".repeat(40), resolveActor: async () => "admin" };
    args.verifyCollector.mockResolvedValue(false);
    expect(await reconcileInvestigationResolutions(reconciliation)).toBe(0);
    expect(args.query).not.toHaveBeenCalled();
    args.verifyCollector.mockResolvedValue(true);
    expect(await reconcileInvestigationResolutions(reconciliation)).toBe(1);
    expect(args.verifyCollector).toHaveBeenCalledWith(reconciliation.productionSha, expect.any(Array), pending.resolution.candidateSha);
    expect(args.query.mock.calls.flat().join(" ")).toContain("Diagnostics improved");
  });

  it("leaves a pending incident outstanding after a new occurrence", async () => {
    const args = input();
    const saved = sealSnapshot({ ...snapshot, issues: [{ ...issue, occurrences: 2, investigation: pending }] });
    expect(await reconcileInvestigationResolutions({ ...args, snapshot: saved, productionSha: "c".repeat(40),
      resolveActor: async () => "admin" })).toBe(0);
    expect(args.query).not.toHaveBeenCalled();
  });

  it("requires the reviewed commit in production and rejects reverted collector files", async () => {
    const productionSha = "c".repeat(40);
    const candidateSha = pending.resolution.candidateSha;
    const paths = pending.collector.paths;
    const verifier = (ancestor: boolean, matches: boolean) => createCollectorVerifier({
      productionSha, stagingSha: "d".repeat(40), cwd: process.cwd(), deployed: true,
      run: args => ({
        status: args[0] === "merge-base" && !ancestor ? 1 : 0,
        stdout: args[1]?.startsWith(productionSha) && !matches ? "e".repeat(40) : "f".repeat(40),
        stderr: "",
      }),
    });
    expect(await verifier(true, true)(productionSha, paths, candidateSha)).toBe(true);
    expect(await verifier(false, true)(productionSha, paths, candidateSha)).toBe(false);
    expect(await verifier(true, false)(productionSha, paths, candidateSha)).toBe(false);
  });

  it("rejects serious issues and repeated use of the same closure reason", async () => {
    const args = input();
    const entries = [{ issueId: issue.id, investigation: { ...record, outcome: "resolved" as const, resolution } }];
    const critical = sealSnapshot({ ...snapshot, issues: [{ ...issue, severity: "CRITICAL" }] });
    await expect(recordInvestigations({ ...args, snapshot: critical, entries })).rejects.toThrow(/stronger verification/);
    const raw = { ...record, completedResolutionReasons: [resolution.reason] };
    const reopened = sealSnapshot({ ...snapshot, issues: [{ ...issue, investigation: record, investigationChecksum: contentChecksum(raw) }] });
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [{ ...issue, investigation: raw }] : [], rowCount: 1 }));
    await expect(recordInvestigations({ ...args, snapshot: reopened, entries })).rejects.toThrow(/recurred/);
    expect(args.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("drafts retained plans and explicitly incomplete updates without inventing findings", () => {
    const saved = sealSnapshot({ ...snapshot, issues: [{ ...issue, investigation: record }, { ...issue, id: "missing" }] });
    expect(draftInvestigationManifest(saved)).toEqual({ issues: [
      { issueId: issue.id, action: "retain" }, { issueId: "missing", action: "update" },
    ] });
  });
  it("retains an existing overdue record without collector, status or audit writes", async () => {
    const args = input();
    const investigation = { ...record, reviewAfter: "2026-10-01T00:00:00.000Z", observedOccurrences: 1 };
    const saved = sealSnapshot({ ...snapshot, issues: [{ ...issue, investigation }] });
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [{ ...issue, investigation }] : [], rowCount: 1 }));
    const result = await recordInvestigations({ ...args, snapshot: saved, apply: true,
      entries: [{ issueId: issue.id, action: "retain" }] });
    expect(result.results[0]).toMatchObject({ action: "retain" });
    expect(args.verifyCollector).not.toHaveBeenCalled();
    expect(args.query.mock.calls.some(([sql]) => /UPDATE "MonitoringIssue"|INSERT INTO/.test(sql))).toBe(false);
  });
  it("rejects retaining missing plans and concurrent investigation reviews before any writes", async () => {
    await expect(recordInvestigations({ ...input(), entries: [{ issueId: issue.id, action: "retain" }] })).rejects.toThrow(/retain/i);
    const args = input();
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [{ ...issue, investigation: { ...record, owner: "Another reviewer" } }] : [], rowCount: 1 }));
    await expect(recordInvestigations({ ...args, apply: true })).rejects.toThrow(/investigation changed/i);
    expect(args.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("checks retained raw review metadata before writing any mixed-manifest update", async () => {
    const args = input();
    const raw = { ...record, runId: "previous-review", evidenceBundle: [] };
    const retained = { ...issue, id: "retained", investigation: record, investigationChecksum: contentChecksum(raw) };
    const saved = sealSnapshot({ ...snapshot, issues: [issue, retained] });
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE")
      ? [issue, { ...retained, investigation: { ...raw, runId: "concurrent-review" } }] : [], rowCount: 1 }));
    await expect(recordInvestigations({ ...args, snapshot: saved, apply: true,
      entries: [...args.entries, { issueId: retained.id, action: "retain" }] })).rejects.toThrow(/investigation changed/i);
    expect(args.query.mock.calls.some(([sql]) => /UPDATE "MonitoringIssue"|INSERT INTO/.test(sql))).toBe(false);
    expect(args.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("verifies identical deployed collectors only once per invocation", async () => {
    const args = input();
    const second = { ...issue, id: "issue-2" };
    const saved = sealSnapshot({ ...snapshot, issues: [issue, second] });
    args.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FOR UPDATE") ? [issue, second] : [], rowCount: 1 }));
    const investigation = { ...record, collector: { ...record.collector, state: "deployed" as const, deploymentSha: "b".repeat(40) } };
    const entries = saved.issues.map(i => ({ issueId: i.id, action: "update" as const, investigation }));
    await recordInvestigations({ ...args, snapshot: saved, entries });
    expect(args.verifyCollector).toHaveBeenCalledTimes(1);
    await recordInvestigations({ ...args, snapshot: saved, entries });
    expect(args.verifyCollector).toHaveBeenCalledTimes(2);
  });
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
