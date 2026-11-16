import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectAndAcknowledgeIssues } from "@/scripts/fixerrors/collect";
import type { OpenIssueSnapshot, PgClientLike } from "@/scripts/fixerrors/types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), archive: vi.fn(), receipt: vi.fn(), actor: vi.fn(), ack: vi.fn() }));
vi.mock("@/scripts/fixerrors/snapshot", () => ({ fetchOpenIssueSnapshot: mocks.fetch,
  writeAndVerifySnapshot: mocks.archive, writeAndVerifyTextArtifactAtomic: mocks.receipt }));
vi.mock("@/scripts/fixerrors/resolve", () => ({ resolveActorAdminId: mocks.actor }));
vi.mock("@/scripts/fixerrors/acknowledge", () => ({ acknowledgeSnapshotIssues: mocks.ack }));
const client = { query: vi.fn() } as PgClientLike;
const snapshot = (statuses: string[]) => ({ snapshotId: "test-snapshot",
  issues: statuses.map((status, index) => ({ id: `issue-${index}`, status })) }) as OpenIssueSnapshot;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.archive.mockImplementation(value => value);
  mocks.actor.mockResolvedValue("admin");
  mocks.ack.mockResolvedValue({ applied: true, results: [{ issueId: "issue-0", decision: "acknowledged" }] });
});

describe("normal fixerrors collection acknowledgement", () => {
  it("archives exact collected identities, acknowledges them, then reports a fresh snapshot", async () => {
    const first = snapshot(["OPEN", "ACKNOWLEDGED"]), fresh = snapshot(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
    mocks.fetch.mockResolvedValueOnce(first).mockResolvedValueOnce(fresh);
    const result = await collectAndAcknowledgeIssues(client, "production-bound-target");
    expect(mocks.archive).toHaveBeenCalledWith(first, expect.stringMatching(/acknowledgements[\\/]test-snapshot\.json$/));
    expect(mocks.ack).toHaveBeenCalledWith({ client, snapshot: first, databaseTargetFingerprint: "production-bound-target", actorAdminId: "admin", apply: true });
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(mocks.ack.mock.invocationCallOrder[0]);
    expect(mocks.receipt.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[1]);
    expect(result).toEqual({ snapshot: fresh, acknowledged: 1, skipped: 0 });
  });
  it.each([{ statuses: [] }, { statuses: ["ACKNOWLEDGED"] }])("does not mutate an empty or already acknowledged queue $statuses", async ({ statuses }) => {
    const collected = snapshot(statuses);mocks.fetch.mockResolvedValue(collected);
    expect(await collectAndAcknowledgeIssues(client, "target")).toEqual({ snapshot: collected, acknowledged: 0, skipped: 0 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.actor).not.toHaveBeenCalled();expect(mocks.ack).not.toHaveBeenCalled();
  });
  it("keeps changed and newly arrived OPEN issues visible without an unbounded acknowledgement loop", async () => {
    mocks.fetch.mockResolvedValueOnce(snapshot(["OPEN"])).mockResolvedValueOnce(snapshot(["OPEN", "OPEN"]));
    mocks.ack.mockResolvedValue({ applied: true, results: [{ decision: "skipped-stale" }] });
    const result = await collectAndAcknowledgeIssues(client, "target");
    expect(result.skipped).toBe(1);expect(result.acknowledged).toBe(0);
    expect(result.snapshot.issues.every(issue => issue.status === "OPEN")).toBe(true);
    expect(mocks.ack).toHaveBeenCalledTimes(1);expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not acknowledge anything if saving the input evidence fails", async () => {
    mocks.fetch.mockResolvedValue(snapshot(["OPEN"]));mocks.archive.mockImplementation(() => { throw new Error("disk full"); });
    await expect(collectAndAcknowledgeIssues(client, "target")).rejects.toThrow("disk full");
    expect(mocks.ack).not.toHaveBeenCalled();
  });
  it("propagates acknowledgement failure instead of claiming success", async () => {
    mocks.fetch.mockResolvedValue(snapshot(["OPEN"]));mocks.ack.mockRejectedValue(new Error("audit write failed"));
    await expect(collectAndAcknowledgeIssues(client, "target")).rejects.toThrow("audit write failed");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
