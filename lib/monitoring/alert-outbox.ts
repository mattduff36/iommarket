import { lookup } from "node:dns/promises";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendMonitoringAlertEmail } from "@/lib/email/resend";
import { logMonitoringFallback } from "./fallback-log";
import { recordAlertFailure, recordAlertSuccess } from "./health";
import { notifyMonitoringWebhook } from "./notify-webhook";
import { MAX_ALERT_ATTEMPTS, alertRetryDelayMs } from "./alert-policy";
import {
  signMonitoringWebhook,
  validateMonitoringWebhookUrl,
  type WebhookLookup,
} from "./webhook-security";

const CLAIM_MS = 2 * 60 * 1000;

export interface AlertPayload {
  subject: string;
  text: string;
  webhookBody: Record<string, unknown>;
  dryRun?: boolean;
}

interface DeliveryRow {
  id: string;
  issueId: string | null;
  channel: "EMAIL" | "WEBHOOK";
  kind: "IMMEDIATE" | "DIGEST" | "CANARY";
  target: string;
  attempts: number;
  payload: Prisma.JsonValue;
  status: "PENDING" | "FAILED" | "SENT" | "SKIPPED";
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function asPayload(value: Prisma.JsonValue): AlertPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.subject !== "string" || typeof record.text !== "string") return null;
  if (!record.webhookBody || typeof record.webhookBody !== "object" || Array.isArray(record.webhookBody)) {
    return null;
  }
  return {
    subject: record.subject,
    text: record.text,
    webhookBody: record.webhookBody as Record<string, unknown>,
    dryRun: record.dryRun === true,
  };
}

async function markFailure(delivery: DeliveryRow, error: string, permanent: boolean, now: Date) {
  const attempts = delivery.attempts;
  const exhausted = permanent || attempts >= MAX_ALERT_ATTEMPTS;
  await db.monitoringAlertDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "FAILED",
      attempts: permanent ? MAX_ALERT_ATTEMPTS : attempts,
      lastError: error.slice(0, 500),
      claimedAt: null,
      claimExpiresAt: null,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + alertRetryDelayMs(attempts)),
    },
  });
  await recordAlertFailure(new Error(error), now);
}

export async function enqueueMonitoringAlert(input: {
  issueId?: string | null;
  eventId?: string | null;
  channel: "EMAIL" | "WEBHOOK";
  kind?: "IMMEDIATE" | "DIGEST" | "CANARY";
  target: string;
  payload: AlertPayload;
  nextAttemptAt?: Date;
}) {
  return db.monitoringAlertDelivery.create({
    data: {
      issueId: input.issueId ?? null,
      eventId: input.eventId ?? null,
      channel: input.channel,
      kind: input.kind ?? "IMMEDIATE",
      target: input.target,
      status: "PENDING",
      attempts: 0,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      nextAttemptAt: input.nextAttemptAt ?? new Date(),
    },
    select: { id: true },
  });
}

export async function processMonitoringAlertOutbox(options: {
  now?: Date;
  limit?: number;
  deliveryId?: string;
  sendEmail?: typeof sendMonitoringAlertEmail;
  notifyWebhook?: typeof notifyMonitoringWebhook;
  lookupHost?: WebhookLookup["lookup"];
  webhookSecret?: string;
} = {}) {
  const now = options.now ?? new Date();
  const sendEmail = options.sendEmail ?? sendMonitoringAlertEmail;
  const notifyWebhook = options.notifyWebhook ?? notifyMonitoringWebhook;
  const lookupHost = options.lookupHost ?? defaultLookup;
  const secret = options.webhookSecret ?? process.env.MONITORING_ALERT_WEBHOOK_SECRET ?? "";
  const due = await db.monitoringAlertDelivery.findMany({
    where: {
      ...(options.deliveryId ? { id: options.deliveryId } : {}),
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ALERT_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }] }],
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 10,
  });

  let sent = 0;
  let failed = 0;
  for (const candidate of due) {
    const claimed = await db.monitoringAlertDelivery.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }],
      },
      data: {
        status: "PENDING",
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + CLAIM_MS),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    const delivery: DeliveryRow = { ...candidate, attempts: candidate.attempts + 1 };
    const payload = asPayload(candidate.payload);
    if (!payload) {
      await markFailure(delivery, "Alert payload is missing", true, now);
      failed += 1;
      continue;
    }
    if (payload.dryRun) {
      await db.monitoringAlertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          sentAt: now,
          lastError: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      sent += 1;
      continue;
    }
    try {
      const { captureStagingTestEffect } = await import("@/lib/deployment/staging-test-effects");
      const captured = await captureStagingTestEffect({
        kind: delivery.channel === "EMAIL" ? "EMAIL" : "WEBHOOK",
        entityId: delivery.id,
        payload: { target: delivery.target, ...payload },
      });
      if (captured) {
        // Complete the local outbox state below without provider configuration or DNS.
      } else if (delivery.channel === "EMAIL") {
        await sendEmail({
          to: delivery.target.split(",").map((item) => item.trim()).filter(Boolean),
          subject: payload.subject,
          text: payload.text,
        });
      } else {
        if (!secret) throw Object.assign(new Error("Webhook signing secret is not configured"), { permanent: true });
        const validated = await validateMonitoringWebhookUrl(delivery.target, { lookup: lookupHost });
        if (!validated.ok) throw Object.assign(new Error(validated.error), { permanent: true });
        const body = JSON.stringify(payload.webhookBody);
        const timestamp = now.getTime();
        const result = await notifyWebhook({
          webhookUrl: validated.url.toString(),
          payload: payload.webhookBody,
          headers: { "X-IOM-Monitoring-Signature": signMonitoringWebhook(secret, timestamp, body) },
          body,
        });
        if (!result.ok) throw new Error(result.error ?? "Webhook failed");
      }
      await db.monitoringAlertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          sentAt: now,
          lastError: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      });
      if (delivery.kind === "IMMEDIATE" && delivery.issueId) {
        await db.monitoringIssue.update({
          where: { id: delivery.issueId },
          data: { lastAlertedAt: now },
        });
      }
      await recordAlertSuccess(now);
      sent += 1;
    } catch (error) {
      const permanent = Boolean(error && typeof error === "object" && "permanent" in error && (error as { permanent?: boolean }).permanent);
      const message = error instanceof Error ? error.message : "Alert delivery failed";
      await markFailure(delivery, message, permanent, now);
      failed += 1;
      logMonitoringFallback({ kind: "alert-delivery-failed", message, issueId: delivery.issueId ?? undefined });
    }
  }
  return { processed: sent + failed, sent, failed };
}
