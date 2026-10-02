import { db } from "@/lib/db";
import { getMonitoringAlertEmailRecipientsAsync, getMonitoringAlertMinSeverityAsync, getMonitoringAlertWebhookUrlAsync } from "@/lib/config/monitoring";
import { monitoringAppUrl } from "./alert-message";
import { enqueueMonitoringAlert, processMonitoringAlertOutbox } from "./alert-outbox";
import { logMonitoringFallback } from "./fallback-log";
import { severitiesBelow } from "./severity";

const DIGEST_INTERVAL_MS = 20 * 60 * 60 * 1000;

export async function sendMonitoringDigest(now = new Date()) {
  const health = await db.monitoringPipelineHealth.findUnique({ where: { id: "singleton" } });
  if (health?.lastDigestAt && now.getTime() - health.lastDigestAt.getTime() < DIGEST_INTERVAL_MS) {
    return { sent: false, events: 0, reason: "interval" as const };
  }

  const [minSeverity, recipients, webhookUrl] = await Promise.all([
    getMonitoringAlertMinSeverityAsync(),
    getMonitoringAlertEmailRecipientsAsync(),
    getMonitoringAlertWebhookUrlAsync(),
  ]);
  const severities = severitiesBelow(minSeverity);
  const since = health?.lastDigestAt ?? new Date(now.getTime() - DIGEST_INTERVAL_MS);
  const events = severities.length === 0
    ? []
    : await db.monitoringEvent.findMany({
        where: { occurredAt: { gt: since }, severity: { in: severities } },
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: {
          severity: true,
          message: true,
          issue: { select: { id: true, title: true, occurrences: true } },
        },
      });

  await db.monitoringPipelineHealth.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastDigestAt: now },
    update: { lastDigestAt: now },
  });

  if (events.length === 0 || (recipients.length === 0 && !webhookUrl.trim())) {
    return { sent: false, events: events.length, reason: "empty" as const };
  }

  const appUrl = monitoringAppUrl();
  const lines = events.slice(0, 20).map((event) => (
    `- [${event.severity}] ${event.issue.title} (${event.issue.occurrences}) ${appUrl}/admin/monitoring/${event.issue.id}`
  ));
  const text = [
    "iTrader monitoring digest",
    "",
    `${events.length} lower-severity event${events.length === 1 ? "" : "s"} since ${since.toISOString()}.`,
    "",
    ...lines,
    "",
    `Review in admin: ${appUrl}/admin/monitoring`,
  ].join("\n");
  const payload = {
    subject: `[Monitoring][DIGEST] ${events.length} lower-severity events`,
    text,
    webhookBody: {
      app: "iommarket",
      type: "monitoring_digest",
      eventCount: events.length,
      adminUrl: `${appUrl}/admin/monitoring`,
    },
  };

  try {
    if (recipients.length > 0) {
      await enqueueMonitoringAlert({
        channel: "EMAIL",
        kind: "DIGEST",
        target: recipients.join(","),
        payload,
      });
    }
    if (webhookUrl.trim()) {
      await enqueueMonitoringAlert({
        channel: "WEBHOOK",
        kind: "DIGEST",
        target: webhookUrl.trim(),
        payload,
      });
    }
    await processMonitoringAlertOutbox({ limit: 5, now });
    return { sent: true, events: events.length, reason: "sent" as const };
  } catch (error) {
    logMonitoringFallback({
      kind: "digest-failed",
      message: error instanceof Error ? error.message : "Digest failed",
    });
    return { sent: false, events: events.length, reason: "failed" as const };
  }
}
