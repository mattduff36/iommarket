import { db } from "@/lib/db";
import { expireMutedMonitoringIssues } from "./mute-expiry";
import { processMonitoringAlertOutbox } from "./alert-outbox";
import { sendMonitoringDigest } from "./digest";
import { runMonitoringCanary } from "./canary";
import { compactMonitoringHistory } from "./retention";
import { checkVercelErrorAlerts } from "./vercel-fallback";
import { logMonitoringFallback } from "./fallback-log";

const DAILY_MS = 20 * 60 * 60 * 1000;

export async function runMonitoringMaintenance(now = new Date()) {
  const unmuted = await expireMutedMonitoringIssues();
  const outbox = await processMonitoringAlertOutbox({ now, limit: 20 });
  const digest = await sendMonitoringDigest(now);
  const canary = await runMonitoringCanary(now);

  const health = await db.monitoringPipelineHealth.findUnique({ where: { id: "singleton" } });
  let retention = null;
  if (!health?.lastRetentionAt || now.getTime() - health.lastRetentionAt.getTime() >= DAILY_MS) {
    retention = await compactMonitoringHistory(now);
  }

  let vercelFallback = health?.vercelFallbackStatus ?? "unknown";
  if (!health?.vercelFallbackCheckedAt || now.getTime() - health.vercelFallbackCheckedAt.getTime() >= DAILY_MS) {
    try {
      vercelFallback = await checkVercelErrorAlerts({ now });
      await db.monitoringPipelineHealth.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          vercelFallbackStatus: vercelFallback,
          vercelFallbackCheckedAt: now,
        },
        update: {
          vercelFallbackStatus: vercelFallback,
          vercelFallbackCheckedAt: now,
        },
      });
    } catch (error) {
      logMonitoringFallback({
        kind: "vercel-fallback-check-failed",
        message: error instanceof Error ? error.message : "Vercel alert check failed",
      });
    }
  }

  return { unmuted, outbox, digest, canary, retention, vercelFallback };
}
