import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { captureBusinessEvent } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import {
  eventFromMinimizedPayload,
  type RippleMinimizedPayload,
} from "@/lib/payments/ripple-contract";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import { hashRippleWebhookBody } from "@/lib/payments/ripple-signature";
import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";

export const RIPPLE_INBOX_STALE_PENDING_MS = 60_000;
export const RIPPLE_INBOX_MAX_ATTEMPTS = 20;

function isMinimizedPayload(value: unknown): value is RippleMinimizedPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inboxErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "WEBHOOK_PROCESS";
  if (message.includes("Unknown Ripple product")) return "UNKNOWN_PRODUCT";
  if (message.includes("Invalid Ripple reference")) return "INVALID_REFERENCE";
  if (message.includes("Listing payment missing reference")) {
    return "MISSING_REFERENCE";
  }
  if (message.includes("Ambiguous dealer")) return "AMBIGUOUS_DEALER";
  if (message.includes("amount must be")) return "AMOUNT_MISMATCH";
  if (message.includes("subscription charge collision")) {
    return "CHARGE_COLLISION";
  }
  if (message.includes("missing dealer")) return "MISSING_DEALER";
  return "WEBHOOK_PROCESS";
}

export async function persistRippleWebhookInbox(input: {
  rawBody: string;
  event: NormalizedProviderWebhookEvent;
  minimized: RippleMinimizedPayload;
  customerEmailNorm: string | null;
}) {
  const bodyHash = hashRippleWebhookBody(input.rawBody);
  const existing = await db.paymentWebhookInbox.findUnique({
    where: { bodyHash },
  });
  if (existing) return existing;

  try {
    return await db.paymentWebhookInbox.create({
      data: {
        bodyHash,
        eventType: input.event.rawType,
        eventTimestamp: input.event.eventTimestamp ?? new Date(),
        clientId: input.event.clientId ?? "unknown",
        paymentReference: input.event.providerPaymentId,
        merchantReference: input.event.providerReference,
        linkCode: input.event.linkCode,
        packageName: input.event.packageName,
        customerEmailNorm: input.customerEmailNorm,
        amountPence: input.event.amount,
        currency: input.event.currency,
        recurring: input.event.recurring,
        linkType: input.event.linkType,
        minimizedPayload: input.minimized as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        attemptCount: 0,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await db.paymentWebhookInbox.findUnique({
        where: { bodyHash },
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export async function processRippleInboxRecord(inboxId: string) {
  const inbox = await db.paymentWebhookInbox.findUnique({
    where: { id: inboxId },
  });
  if (!inbox) return { status: "missing" as const };
  if (inbox.status === "PROCESSED") return { status: "duplicate" as const };
  if (inbox.status === "QUARANTINED") return { status: "quarantined" as const };

  const staleBefore = new Date(Date.now() - RIPPLE_INBOX_STALE_PENDING_MS);
  const claimed = await db.paymentWebhookInbox.updateMany({
    where: {
      id: inbox.id,
      attemptCount: {
        equals: inbox.attemptCount,
        lt: RIPPLE_INBOX_MAX_ATTEMPTS,
      },
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", updatedAt: { lte: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lastErrorCode: null,
    },
  });
  if (claimed.count !== 1) {
    return { status: "processing" as const };
  }
  const claimedAttempt = inbox.attemptCount + 1;

  try {
    if (!isMinimizedPayload(inbox.minimizedPayload)) {
      throw new Error("Inbox payload is not replayable");
    }
    const event = eventFromMinimizedPayload({
      minimized: inbox.minimizedPayload,
      customerEmailNorm: inbox.customerEmailNorm,
    });
    await processProviderWebhookEvent(event);
    const completed = await db.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "PROCESSING",
        attemptCount: claimedAttempt,
      },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastErrorCode: null,
      },
    });
    if (completed.count !== 1) {
      return { status: "processing" as const };
    }
    return { status: "processed" as const };
  } catch (error) {
    const code = inboxErrorCode(error);
    const quarantined =
      code === "UNKNOWN_PRODUCT" || code === "CHARGE_COLLISION";
    const failed = await db.paymentWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: "PROCESSING",
        attemptCount: claimedAttempt,
      },
      data: {
        status: quarantined ? "QUARANTINED" : "FAILED",
        lastErrorCode: code,
      },
    });
    if (failed.count !== 1) {
      return { status: "processing" as const };
    }
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: quarantined ? "HIGH" : "MEDIUM",
      title: quarantined
        ? "Ripple webhook quarantined"
        : "Ripple webhook processing failed",
      message: "A verified Ripple webhook could not be applied.",
      action: "processRippleInboxRecord",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: buildRippleSafeTags({
        inboxId: inbox.id,
        eventType: inbox.eventType,
        errorCode: code,
      }),
    });
    return { status: quarantined ? "quarantined" as const : "failed" as const };
  }
}

export async function ingestVerifiedRippleWebhook(input: {
  rawBody: string;
  event: NormalizedProviderWebhookEvent;
  minimized: RippleMinimizedPayload;
  customerEmailNorm: string | null;
}) {
  const inbox = await persistRippleWebhookInbox(input);
  if (inbox.status !== "PROCESSED") {
    await processRippleInboxRecord(inbox.id);
  }
  return inbox;
}

export async function retryFailedRippleWebhooks(limit = 25) {
  const staleBefore = new Date(Date.now() - RIPPLE_INBOX_STALE_PENDING_MS);
  const recoverable = await db.paymentWebhookInbox.findMany({
    where: {
      attemptCount: { lt: RIPPLE_INBOX_MAX_ATTEMPTS },
      OR: [
        { status: "FAILED" },
        { status: "PENDING", updatedAt: { lte: staleBefore } },
        { status: "PROCESSING", updatedAt: { lte: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results = {
    attempted: recoverable.length,
    processed: 0,
    failed: 0,
    quarantined: 0,
  };

  for (const item of recoverable) {
    const result = await processRippleInboxRecord(item.id);
    if (result.status === "processed") results.processed += 1;
    if (result.status === "failed") results.failed += 1;
    if (result.status === "quarantined") results.quarantined += 1;
  }

  return results;
}
