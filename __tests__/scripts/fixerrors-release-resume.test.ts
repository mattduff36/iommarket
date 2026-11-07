import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ readManifest: vi.fn(), readSnapshot: vi.fn(), verify: vi.fn(), append: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: (path: string) => !path.endsWith("release.json") || path.includes("first") || path.includes("second"), readdirSync: (path: string) => path.endsWith("runs") ? ["first", "second"].map(name => ({ name, isDirectory: () => true, isSymbolicLink: () => false })) : [] }));
vi.mock("@/scripts/fixerrors/release", () => ({ readReleaseManifest: mocks.readManifest, verifyProductionRelease: mocks.verify }));
vi.mock("@/scripts/fixerrors/snapshot", () => ({ readAndVerifySnapshot: mocks.readSnapshot, assertSnapshotTarget: vi.fn() }));
vi.mock("@/scripts/fixerrors/alert-log", () => ({ appendAlertLog: mocks.append }));
import { resumeReleases } from "@/scripts/fixerrors/release-resume";
import type { PgClientLike } from "@/scripts/fixerrors/types";
describe("release resumption", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.readManifest.mockReturnValue({ snapshotId: "snapshot-1", clusterId: "cluster-1", issueIds: ["issue-1"] }); mocks.readSnapshot.mockReturnValue({ issues: [{ id: "issue-1", fingerprint: "fp", source: "CLIENT" }] }); });
  it("continues past a damaged record and records post-deployment recurrence", async () => {
    mocks.readManifest.mockImplementationOnce(() => { throw new Error("Corrupt archive"); });
    mocks.verify.mockResolvedValue({ ok: true, applied: true, recurred: ["issue-1"], resolvable: [] });
    const results = await resumeReleases({ client: { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PgClientLike, databaseTargetFingerprint: "target", actorAdminId: "admin", apply: true });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: false, applied: false, reason: "Corrupt archive" });
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.append).toHaveBeenCalledWith([expect.objectContaining({ outcome: "recurred", fingerprint: "fp" })]);
  });
  it("does not record a hypothetical recurrence during dry run", async () => {
    mocks.verify.mockResolvedValue({ ok: true, applied: false, recurred: ["issue-1"], resolvable: [] });
    await resumeReleases({ client: { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PgClientLike, databaseTargetFingerprint: "target", actorAdminId: "admin", apply: false });
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
