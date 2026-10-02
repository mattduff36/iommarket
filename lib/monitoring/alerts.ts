import { db } from "@/lib/db";
import {
  getMonitoringAlertCooldownMinutesAsync,
  getMonitoringAlertEmailRecipientsAsync,
  getMonitoringAlertMinSeverityAsync,
  getMonitoringAlertWebhookUrlAsync,
} from "@/lib/config/monitoring";
import { buildAlertSubject, buildAlertText, monitoringAppUrl } from "./alert-message";
import { decideMonitoringAlert } from "./alert-policy";
import { enqueueMonitoringAlert, processMonitoringAlertOutbox } from "./alert-outbox";
import { logMonitoringFallback } from "./fallback-log";
import { recordAlertSuppression } from "./health";
import type { MonitoringSeverity } from "./types";

function webhookBody(params: {
  issueId: string;
  eventId: string;
  severity: MonitoringSeverity;
  status: string;
  source: string;
  title: string;
  message: string;
  route: string | null;
  action: string | null;
  occurrences: number;
  requestPath: string | null;
  environment: string;
  occurredAt: string;
  reason: string;
  appUrl: string;
}) {
  return {
    app: "iommarket",
    type: "monitoring_alert",
    reason: params.reason,
    issue: {
      id: params.issueId,
      severity: params.severity,
      status: params.status,
      source: params.source,
      title: params.title,
      message: params.message,
      route: params.route,
      action: params.action,
      occurrences: params.occurrences,
    },
    event: {
      id: params.eventId,
      occurredAt: params.occurredAt,
      requestPath: params.requestPath,
      environment: params.environment,
    },
    adminUrl: `${params.appUrl}/admin/monitoring/${params.issueId}`,
  };
}

export async function dispatchMonitoringAlerts(input: {
  issueId: string;
  eventId: string;
  reopened?: boolean;
  previousLastSeenAt?: Date | null;
}) {
  try {
    const [issue, event, minSeverity, cooldownMinutes, emailRecipients, webhookUrl] = await Promise.all([
      db.monitoringIssue.findUnique({ where: { id: input.issueId } }),
      db.monitoringEvent.findUnique({ where: { id: input.eventId } }),
      getMonitoringAlertMinSeverityAsync(),
      getMonitoringAlertCooldownMinutesAsync(),
      getMonitoringAlertEmailRecipientsAsync(),
      getMonitoringAlertWebhookUrlAsync(),
    ]);
    if (!issue || !event) return;

    const decision = decideMonitoringAlert({
      status: issue.status,
      reopened: input.reopened,
      severity: issue.severity,
      eventSeverity: event.severity,
      acknowledgedSeverity: issue.acknowledgedSeverity,
      mutedUntil: issue.mutedUntil,
      lastAlertedAt: issue.lastAlertedAt,
      previousLastSeenAt: input.previousLastSeenAt,
      now: new Date(),
      minSeverity,
      cooldownMinutes,
      hasChannel: emailRecipients.length > 0 || webhookUrl.trim().length > 0,
    });

    if (decision.action === "suppress") {
      if (decision.reason !== "no-channel") {
        await db.monitoringIssue.update({
          where: { id: issue.id },
          data: { suppressedAlertCount: { increment: 1 } },
        });
        await recordAlertSuppression();
      }
      return;
    }
    if (decision.action === "digest") return;

    const appUrl = monitoringAppUrl();
    const payload = {
      subject: buildAlertSubject({
        severity: issue.severity,
        source: issue.source,
        title: issue.title,
      }),
      text: buildAlertText({
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
        reason: decision.reason,
        appUrl,
      }),
      webhookBody: webhookBody({
        issueId: issue.id,
        eventId: event.id,
        severity: issue.severity,
        status: issue.status,
        source: issue.source,
        title: issue.title,
        message: issue.sampleMessage,
        route: issue.sampleRoute,
        action: issue.sampleAction,
        occurrences: issue.occurrences,
        requestPath: event.requestPath,
        environment: event.environment,
        occurredAt: event.occurredAt.toISOString(),
        reason: decision.reason,
        appUrl,
      }),
    };

    if (emailRecipients.length > 0) {
      await enqueueMonitoringAlert({
        issueId: issue.id,
        eventId: event.id,
        channel: "EMAIL",
        target: emailRecipients.join(","),
        payload,
      });
    }
    if (webhookUrl.trim()) {
      await enqueueMonitoringAlert({
        issueId: issue.id,
        eventId: event.id,
        channel: "WEBHOOK",
        target: webhookUrl.trim(),
        payload,
      });
    }
    await processMonitoringAlertOutbox({ limit: 5 });
  } catch (error) {
    logMonitoringFallback({
      kind: "alert-dispatch-failed",
      message: error instanceof Error ? error.message : "Alert dispatch failed",
      issueId: input.issueId,
      eventId: input.eventId,
    });
  }
}
