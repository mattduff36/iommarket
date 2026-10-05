import { db } from "@/lib/db";
import { captureBusinessEvent } from "@/lib/monitoring";
import { runPaymentSerializable } from "@/lib/payments/transaction";

const BATCH_SIZE = 50;
const ALERT_LEASE_MS = 5 * 60 * 1000;

export async function detectStalePaymentAttempts(now = new Date()) {
  const candidates = await db.paymentCheckoutAttempt.findMany({
    where: {
      status: { in: ["OPEN", "RETURNED", "REVIEW"] },
      expiresAt: { lte: now },
      alertedAt: null,
      OR: [{ alertLeaseUntil: null }, { alertLeaseUntil: { lte: now } }],
    },
    orderBy: { expiresAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      merchantReference: true,
      observations: { select: { providerPaymentId: true }, take: 2 },
    },
  });

  let alerted = 0;
  for (const attempt of candidates) {
    if (attempt.status !== "REVIEW") {
      await db.paymentCheckoutAttempt.updateMany({
        where: {
          id: attempt.id,
          status: { in: ["OPEN", "RETURNED"] },
          alertedAt: null,
          OR: [{ alertLeaseUntil: null }, { alertLeaseUntil: { lte: now } }],
          reconciliations: { none: {} },
          providerClaims: { none: {} },
        },
        data: { status: "REVIEW" },
      });
      continue;
    }

    const leaseUntil = new Date(now.getTime() + ALERT_LEASE_MS);
    const claimed = await db.paymentCheckoutAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "REVIEW",
        alertedAt: null,
        OR: [{ alertLeaseUntil: null }, { alertLeaseUntil: { lte: now } }],
        reconciliations: { none: {} },
        providerClaims: { none: {} },
      },
      data: { alertLeaseUntil: leaseUntil },
    });
    if (claimed.count !== 1) continue;

    try {
      const delivered = await runPaymentSerializable(async (client) => {
        await client.$queryRaw`
          SELECT "id"
          FROM "PaymentCheckoutAttempt"
          WHERE "id" = ${attempt.id}
          FOR UPDATE
        `;
        const stillStale = await client.paymentCheckoutAttempt.findFirst({
          where: {
            id: attempt.id,
            status: "REVIEW",
            alertedAt: null,
            alertLeaseUntil: leaseUntil,
            reconciliations: { none: {} },
            providerClaims: { none: {} },
          },
          select: { id: true },
        });
        if (!stillStale) return false;

        const observedProviderIds = attempt.observations.map(
          (observation) => observation.providerPaymentId,
        );
        const inboxCount = await client.paymentWebhookInbox.count({
          where: {
            OR: [
              { merchantReference: attempt.merchantReference },
              ...(observedProviderIds.length > 0
                ? [{ paymentReference: { in: observedProviderIds } }]
                : []),
            ],
          },
        });
        const captured = await captureBusinessEvent({
          source: "BUSINESS",
          severity: "HIGH",
          title:
            inboxCount === 0
              ? "Ripple checkout has no webhook receipt"
              : "Ripple checkout is stale",
          message:
            inboxCount === 0
              ? "A persisted checkout expired without a matching webhook inbox record."
              : "A persisted checkout expired before verified reconciliation completed.",
          action: "detectStalePaymentAttempts",
          route: "/api/cron/ripple-webhook-retry",
          requestPath: "/api/cron/ripple-webhook-retry",
          dedupeKey: `stale-payment-attempt:${attempt.id}`,
          tags: {
            attemptId: attempt.id,
            checkoutKind: attempt.kind,
            hasBrowserObservation: attempt.observations.length > 0,
            hasInboxReceipt: inboxCount > 0,
          },
          extra: { createdAt: attempt.createdAt.toISOString() },
        });
        if (!captured) {
          await client.paymentCheckoutAttempt.updateMany({
            where: {
              id: attempt.id,
              status: "REVIEW",
              alertLeaseUntil: leaseUntil,
            },
            data: { alertLeaseUntil: null },
          });
          return false;
        }

        const marked = await client.paymentCheckoutAttempt.updateMany({
          where: {
            id: attempt.id,
            status: "REVIEW",
            alertedAt: null,
            alertLeaseUntil: leaseUntil,
            reconciliations: { none: {} },
            providerClaims: { none: {} },
          },
          data: { alertedAt: now, alertLeaseUntil: null },
        });
        return marked.count === 1;
      });
      if (delivered) alerted += 1;
    } catch (error) {
      await db.paymentCheckoutAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "REVIEW",
          alertLeaseUntil: leaseUntil,
        },
        data: { alertLeaseUntil: null },
      });
      throw error;
    }
  }

  return { reviewed: candidates.length, alerted };
}
