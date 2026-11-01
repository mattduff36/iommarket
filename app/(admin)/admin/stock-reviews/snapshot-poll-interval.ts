import type { StockReviewSnapshot } from "./snapshot-loader";

/** Fast feedback for active work; avoid Redis polling all day for offline devices. */
export function stockSnapshotPollInterval(snapshot: StockReviewSnapshot): number {
  if (snapshot.jobs.some(job => job.status === "LEASED" || job.status === "QUEUED")) return 5_000;
  if (!snapshot.dashboard.ok) return 60_000;
  if (snapshot.dashboard.devices.some(device => device.online &&
    (device.state === "stopping" || device.pendingCommand))) return 5_000;
  // Keep this below the existing 35-second worker freshness window.
  return snapshot.dashboard.devices.some(device => device.online) ? 15_000 : 60_000;
}
