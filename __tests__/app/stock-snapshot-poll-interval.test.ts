import { describe, expect, it } from "vitest";
import { stockSnapshotPollInterval } from "@/app/(admin)/admin/stock-reviews/snapshot-poll-interval";
import type { StockReviewSnapshot } from "@/app/(admin)/admin/stock-reviews/snapshot-loader";

function snapshot(online: boolean, state = "stopped", status?: string) {
  return { jobs: status ? [{ status }] : [], dashboard: { ok: true, devices: [{ online, state, pendingCommand: null }] } } as StockReviewSnapshot;
}
describe("stock polling cadence", () => {
  it("reduces idle reads without slowing active jobs or pending work", () => {
    expect(stockSnapshotPollInterval(snapshot(false))).toBe(60_000);
    expect(stockSnapshotPollInterval(snapshot(true))).toBe(15_000);
    expect(stockSnapshotPollInterval(snapshot(true, "running"))).toBe(15_000);
    expect(stockSnapshotPollInterval(snapshot(false, "stopped", "QUEUED"))).toBe(5_000);
    expect(stockSnapshotPollInterval(snapshot(false, "stopped", "LEASED"))).toBe(5_000);
  });
});
