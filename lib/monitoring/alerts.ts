import { db } from "@/lib/db";
import { sendMonitoringAlertEmail } from "@/lib/email/resend";
import {
  getMonitoringAlertCooldownMinutesAsync,
  getMonitoringAlertEmailRecipientsAsync,
  getMonitoringAlertMinSeverityAsync,
  getMonitoringAlertWebhookUrlAsync,
} from "@/lib/config/monitoring";
import { notifyMonitoringWebhook } from "./notify-webhook";
import type { MonitoringSeverity } from "./types";

const SEVERITY_RANK: Record<MonitoringSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function isSeverityAtOrAbove(
  value: MonitoringSeverity,
  minimum: MonitoringSeverity
): boolean {
  return SEVERITY_RANK[value] >= SEVERITY_RANK[minimum];
}

function buildAlertSubject(params: {
  severity: MonitoringSeverity;
  source: string;
  title: string;
}) {
  return `[Monitoring][${params.severity}] ${params.source} - ${params.title}`;
}

function buildAlertText(params: {
  issueId: string;
  eventId: string;
  severity: MonitoringSeverity;
  status: string;
  source: string;
  title: string;
  message: string;
  route?: string | null;
  action?: string | null;
  requestPath?: string | null;
  environment: string;
  occurrences: number;
  appUrl: string;
}) {
  const issueUrl = `${params.appUrl}/admin/monitoring/${params.issueId}`;
  return [
    "iTrader Monitoring Alert",
    "",
    `Issue: ${params.issueId}`,
    `Event: ${params.eventId}`,
    `Severity: ${params.severity}`,
    `Status: ${params.status}`,
    `Source: ${params.source}`,
    `Environment: ${params.environment}`,
    `Occurrences: ${params.occurrences}`,
    "",
    `Title: ${params.title}`,
    `Message: ${params.message}`,
    `Route: ${params.route ?? "n/a"}`,
    `Action: ${params.action ?? "n/a"}`,
    `Request path: ${params.requestPath ?? "n/a"}`,
    "",
    `Review in admin: ${issueUrl}`,
  ].join("\n");
}

async function createSkippedDelivery(params: {
  issueId: string;
  eventId: string;
  channel: "EMAIL" | "WEBHOOK";
  target: string;
  reason: string;
}) {
  await db.monitoringAlertDelivery.create({
    data: {
      issueId: params.issueId,
      eventId: params.eventId,
      channel: params.channel,
      target: params.target,
      status: "SKIPPED",
      attempts: 0,
      lastError: params.reason,
    },
  });
}

export async function dispatchMonitoringAlerts(input: {
  issueId: string;
  eventId: string;
}) {
  try {
    const [issue, event] = await Promise.all([
      db.monitoringIssue.findUnique({ where: { id: input.issueId } }),
      db.monitoringEvent.findUnique({ where: { id: input.eventId } }),
    ]);
    if (!issue || !event) return;

    const [minSeverity, cooldownMinutes, emailRecipients, webhookUrl] =
      await Promise.all([
        getMonitoringAlertMinSeverityAsync(),
        getMonitoringAlertCooldownMinutesAsync(),
        getMonitoringAlertEmailRecipientsAsync(),
        getMonitoringAlertWebhookUrlAsync(),
      ]);

    const hasEmail = emailRecipients.length > 0;
    const hasWebhook = webhookUrl.trim().length > 0;
    if (!hasEmail && !hasWebhook) return;

    if (issue.status === "MUTED" && issue.mutedUntil && issue.mutedUntil > new Date()) {
      if (hasEmail) {
        await createSkippedDelivery({
          issueId: issue.id,
          eventId: event.id,
          channel: "EMAIL",
          target: emailRecipients.join(","),
          reason: "Issue is muted",
        });
      }
      if (hasWebhook) {
        await createSkippedDelivery({
          issueId: issue.id,
          eventId: event.id,
          channel: "WEBHOOK",
          target: webhookUrl,
          reason: "Issue is muted",
        });
      }
      return;
    }

    if (!isSeverityAtOrAbove(issue.severity, minSeverity)) {
      if (hasEmail) {
        await createSkippedDelivery({
          issueId: issue.id,
          eventId: event.id,
          channel: "EMAIL",
          target: emailRecipients.join(","),
          reason: `Severity below threshold (${minSeverity})`,
        });
      }
      if (hasWebhook) {
        await createSkippedDelivery({
          issueId: issue.id,
          eventId: event.id,
          channel: "WEBHOOK",
          target: webhookUrl,
          reason: `Severity below threshold (${minSeverity})`,
        });
      }
      return;
    }

    if (issue.lastAlertedAt && cooldownMinutes > 0) {
      const elapsedMs = Date.now() - issue.lastAlertedAt.getTime();
      if (elapsedMs < cooldownMinutes * 60 * 1000) {
        if (hasEmail) {
          await createSkippedDelivery({
            issueId: issue.id,
            eventId: event.id,
            channel: "EMAIL",
            target: emailRecipients.join(","),
            reason: `Cooldown active (${cooldownMinutes}m)`,
          });
        }
        if (hasWebhook) {
          await createSkippedDelivery({
            issueId: issue.id,
            eventId: event.id,
            channel: "WEBHOOK",
            target: webhookUrl,
            reason: `Cooldown active (${cooldownMinutes}m)`,
          });
        }
        return;
      }
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
      /\/$/,
      ""
    );
    const subject = buildAlertSubject({
      severity: issue.severity,
      source: issue.source,
      title: issue.title,
    });
    const text = buildAlertText({
      issueId: issue.id,
      eventId: event.id,
      severity: issue.severity,
      status: issue.status,
      source: issue.source,
      title: issue.title,
      message: issue.sampleMessage,
      route: issue.sampleRoute,
      action: issue.sampleAction,
      requestPath: event.requestPath,
      environment: event.environment,
      occurrences: issue.occurrences,
      appUrl,
    });

    let sentAny = false;

    if (hasEmail) {
      const delivery = await db.monitoringAlertDelivery.create({
        data: {
          issueId: issue.id,
          eventId: event.id,
          channel: "EMAIL",
          target: emailRecipients.join(","),
          status: "PENDING",
          attempts: 0,
        },
      });

      try {
        await sendMonitoringAlertEmail({
          to: emailRecipients,
          subject,
          text,
        });
        await db.monitoringAlertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SENT",
            attempts: 1,
            sentAt: new Date(),
            lastError: null,
          },
        });
        sentAny = true;
      } catch (err) {
        await db.monitoringAlertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            attempts: 1,
            lastError: err instanceof Error ? err.message : "Email send failed",
          },
        });
      }
    }

    if (hasWebhook) {
      const delivery = await db.monitoringAlertDelivery.create({
        data: {
          issueId: issue.id,
          eventId: event.id,
          channel: "WEBHOOK",
          target: webhookUrl,
          status: "PENDING",
          attempts: 0,
        },
      });

      const webhookResult = await notifyMonitoringWebhook({
        webhookUrl,
        payload: {
          app: "iommarket",
          type: "monitoring_alert",
          issue: {
            id: issue.id,
            severity: issue.severity,
            status: issue.status,
            source: issue.source,
            title: issue.title,
            message: issue.sampleMessage,
            route: issue.sampleRoute,
            action: issue.sampleAction,
            occurrences: issue.occurrences,
          },
          event: {
            id: event.id,
            occurredAt: event.occurredAt.toISOString(),
            requestPath: event.requestPath,
            environment: event.environment,
          },
          adminUrl: `${appUrl}/admin/monitoring/${issue.id}`,
        },
      });

      if (webhookResult.ok) {
        await db.monitoringAlertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SENT",
            attempts: 1,
            sentAt: new Date(),
            lastError: null,
          },
        });
        sentAny = true;
      } else {
        await db.monitoringAlertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            attempts: 1,
            lastError:
              webhookResult.error ??
              (webhookResult.status
                ? `Webhook status ${webhookResult.status}`
                : "Webhook failed"),
          },
        });
      }
    }

    if (sentAny) {
      await db.monitoringIssue.update({
        where: { id: issue.id },
        data: { lastAlertedAt: new Date() },
      });
    }
  } catch {
    // Alerting failures must never crash the request path.
  }
}
