import { db } from "@/lib/db";
import { captureBusinessEvent } from "./capture";
import { enqueueMonitoringAlert, processMonitoringAlertOutbox } from "./alert-outbox";
import { logMonitoringFallback } from "./fallback-log";

const CANARY_INTERVAL_MS = 20 * 60 * 60 * 1000;
export const MONITORING_CANARY_MESSAGE = "monitoring-canary";

export async function runMonitoringCanary(now = new Date()) {
  const health = await db.monitoringPipelineHealth.findUnique({ where: { id: "singleton" } });
  if (health?.lastCanaryAt && now.getTime() - health.lastCanaryAt.getTime() < CANARY_INTERVAL_MS) {
    return { status: "skipped" as const };
  }

  const captured = await captureBusinessEvent({
    source: "BUSINESS",
    severity: "LOW",
    title: "Monitoring canary",
    message: MONITORING_CANARY_MESSAGE,
    action: "monitoringCanary",
    tags: { canary: true },
  });

  if (!captured) {
    await db.monitoringPipelineHealth.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastCanaryAt: now, lastCanaryResult: "capture-failed" },
      update: { lastCanaryAt: now, lastCanaryResult: "capture-failed" },
    });
    return { status: "capture-failed" as const };
  }

  const sendLive = process.env.MONITORING_CANARY_SEND === "1";
  const payload = {
    subject: "[Monitoring][CANARY] Capture path verified",
    text: [
      "iTrader monitoring canary",
      "",
      `Issue: ${captured.issueId}`,
      `Event: ${captured.eventId}`,
      "This verifies capture and alert enqueue without repeating a real incident.",
    ].join("\n"),
    webhookBody: {
      app: "iommarket",
      type: "monitoring_canary",
      issueId: captured.issueId,
      eventId: captured.eventId,
    },
    dryRun: !sendLive,
  };

  try {
    await enqueueMonitoringAlert({
      issueId: captured.issueId,
      eventId: captured.eventId,
      channel: "EMAIL",
      kind: "CANARY",
      target: process.env.MONITORING_ALERT_EMAILS || "canary@localhost",
      payload,
    });
    const processed = await processMonitoringAlertOutbox({ limit: 5, now });
    await db.monitoringIssue.update({
      where: { id: captured.issueId },
      data: { status: "RESOLVED", resolvedAt: now },
    });
    await db.monitoringIssueStatusEvent.create({
      data: {
        issueId: captured.issueId,
        toStatus: "RESOLVED",
        notes: "Canary verified and closed",
      },
    });
    const result = processed.sent > 0 ? "verified" : "enqueue-unconfirmed";
    await db.monitoringPipelineHealth.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastCanaryAt: now, lastCanaryResult: result },
      update: { lastCanaryAt: now, lastCanaryResult: result },
    });
    return { status: result, issueId: captured.issueId };
  } catch (error) {
    logMonitoringFallback({
      kind: "canary-failed",
      message: error instanceof Error ? error.message : "Canary failed",
      issueId: captured.issueId,
    });
    await db.monitoringPipelineHealth.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastCanaryAt: now, lastCanaryResult: "failed" },
      update: { lastCanaryAt: now, lastCanaryResult: "failed" },
    });
    return { status: "failed" as const };
  }
}
