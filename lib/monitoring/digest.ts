import { db } from "@/lib/db";
import { getMonitoringAlertEmailRecipientsAsync, getMonitoringAlertMinSeverityAsync, getMonitoringAlertWebhookUrlAsync } from "@/lib/config/monitoring";
import { monitoringAppUrl } from "./alert-message";
import { explainMonitoringAlert } from "./plain-alert";
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
        where: {
          occurredAt: { gt: since },
          severity: { in: severities },
          issue: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          message: { not: "monitoring-canary" },
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: {
          severity: true,
          message: true,
          environment: true,
          route: true,
          issue: { select: { id: true, title: true, occurrences: true, sampleRoute: true, sampleAction: true } },
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
  // Events are newest first: keep the latest example for each distinct issue.
  const seen = new Set<string>();
  const issues = events.filter((event) => {
    if (seen.has(event.issue.id)) return false;
    seen.add(event.issue.id);
    return true;
  });
  const lines = issues.slice(0, 20).map((event) => {
    const plain = explainMonitoringAlert({
      title: event.issue.title,
      message: event.message,
      route: event.route ?? event.issue.sampleRoute,
      action: event.issue.sampleAction,
      environment: event.environment,
      occurrences: event.issue.occurrences,
      severity: event.severity,
    });
    return `- ${plain.summary} ${appUrl}/admin/monitoring/${event.issue.id}`;
  });
  const text = [
    `Here are ${issues.length} distinct smaller issue${issues.length === 1 ? "" : "s"} since ${formatDigestWhen(since)}. Each one was too small for its own email.`,
    ...(issues.length > 20 ? ["Showing the 20 most recently active issues below."] : []),
    "",
    ...lines,
    "",
    `Please open this and take a look: ${appUrl}/admin/monitoring`,
  ].join("\n");
  const payload = {
    subject: `Smaller issues from iTrader`,
    text,
    webhookBody: {
      app: "iommarket",
      type: "monitoring_digest",
      eventCount: events.length,
      issueCount: issues.length,
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

function formatDigestWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).format(date);
}
