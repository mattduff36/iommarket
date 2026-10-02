import { db } from "@/lib/db";

export const MONITORING_DETAIL_RETENTION_DAYS = 90;
export const MONITORING_ISSUE_RETENTION_DAYS = 365;

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function compactMonitoringHistory(now = new Date()) {
  const detailCutoff = daysAgo(now, MONITORING_DETAIL_RETENTION_DAYS);
  const issueCutoff = daysAgo(now, MONITORING_ISSUE_RETENTION_DAYS);

  const clearedPrompts = await db.monitoringIssue.updateMany({
    where: {
      resolvedAt: { lt: detailCutoff },
      lastGeneratedPrompt: { not: null },
    },
    data: { lastGeneratedPrompt: null },
  });
  const deletedDeliveries = await db.monitoringAlertDelivery.deleteMany({
    where: {
      createdAt: { lt: detailCutoff },
      status: { in: ["SENT", "FAILED", "SKIPPED"] },
    },
  });
  const deletedEvents = await db.monitoringEvent.deleteMany({
    where: { occurredAt: { lt: detailCutoff } },
  });
  const deletedIssues = await db.monitoringIssue.deleteMany({
    where: {
      status: "RESOLVED",
      resolvedAt: { lt: issueCutoff },
      lastSeenAt: { lt: issueCutoff },
    },
  });

  await db.monitoringPipelineHealth.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastRetentionAt: now },
    update: { lastRetentionAt: now },
  });

  return {
    clearedPrompts: clearedPrompts.count,
    deletedDeliveries: deletedDeliveries.count,
    deletedEvents: deletedEvents.count,
    deletedIssues: deletedIssues.count,
  };
}
