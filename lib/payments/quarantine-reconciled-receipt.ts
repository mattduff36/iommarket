import type { Prisma } from "@prisma/client";
import { logAdminAction } from "@/lib/admin/audit";
import { getRippleClientId } from "@/lib/payments/ripple-config";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import { normalizeRippleEmail } from "@/lib/payments/ripple-reference";
import { parsePoundsToPence, type RippleMinimizedPayload } from "@/lib/payments/ripple-contract";

type Transaction = Prisma.TransactionClient;

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function payloadAs(value: Prisma.JsonValue): RippleMinimizedPayload | null {
  if (!isRecord(value)) return null;
  return value as unknown as RippleMinimizedPayload;
}

function requireMatch(condition: boolean): asserts condition {
  if (!condition) {
    throw new Error("Failed Ripple receipt conflicts with the confirmed payment reconciliation");
  }
}

function sameSecond(left: number, right: number) {
  return Math.floor(left / 1_000) === Math.floor(right / 1_000);
}

/**
 * A manually attested payment can supersede a failed receipt only when the
 * provider ID, checkout contract, payer, and event time all match persisted
 * reconciliation evidence. Keep the receipt quarantined; it was not replayed.
 */
export async function quarantineReconciledMissingReferenceReceipts(
  tx: Transaction,
  input: {
    adminId: string;
    attemptId: string;
    evidenceId: string;
    providerEventAt: Date;
    providerPaymentId: string;
  },
): Promise<string[]> {
  const receipts = await tx.paymentWebhookInbox.findMany({
    where: {
      paymentReference: input.providerPaymentId,
      eventType: "payment.received",
    },
  });
  const unresolved = receipts.filter((receipt) => receipt.status !== "PROCESSED");
  if (unresolved.length === 0) return [];

  const attempt = await tx.paymentCheckoutAttempt.findUnique({
    where: { id: input.attemptId },
    include: { payment: true, reconciliations: true, providerClaims: true },
  });
  if (!attempt) throw new Error("Confirmed checkout attempt is missing for failed Ripple receipt");
  if (attempt.status !== "CONFIRMED" || !attempt.confirmedAt) {
    throw new Error("Checkout attempt is not confirmed for failed Ripple receipt");
  }
  requireMatch(Boolean(attempt.productCode && attempt.paymentId && attempt.merchantReference));
  requireMatch(attempt.currency === "gbp" && attempt.kind === "FEATURED_UPGRADE");

  const product = getRippleProductByLinkCode(attempt.productCode);
  requireMatch(
    Boolean(product && product.checkoutType === "featured_upgrade" && product.amountPence === attempt.amountPence),
  );

  const payment = attempt.payment;
  requireMatch(
    Boolean(
      payment &&
        payment.id === attempt.paymentId &&
        payment.status === "SUCCEEDED" &&
        payment.paymentProvider === "RIPPLE" &&
        payment.providerPaymentId === input.providerPaymentId &&
        payment.providerReference === attempt.merchantReference &&
        payment.listingId === attempt.listingId &&
        payment.type === "FEATURED" &&
        payment.includesFeatured === false &&
        payment.amount === attempt.amountPence &&
        payment.currency.toLowerCase() === attempt.currency &&
        payment.refundedAt === null,
    ),
  );
  if (!payment) throw new Error("Confirmed payment is missing for failed Ripple receipt");

  const reconciliation = attempt.reconciliations.find(
    (row) =>
      row.evidenceType === "ADMIN_PROVIDER_ATTESTATION" &&
      row.evidenceId === input.evidenceId &&
      row.providerPaymentId === input.providerPaymentId &&
      row.adminId === input.adminId,
  );
  if (!reconciliation) throw new Error("Admin reconciliation evidence is missing for failed Ripple receipt");
  requireMatch(reconciliation.providerEventAt.getTime() === input.providerEventAt.getTime());
  const evidenceSnapshot = isRecord(reconciliation.evidenceSnapshot)
    ? reconciliation.evidenceSnapshot
    : null;
  requireMatch(
    evidenceSnapshot?.confirmedAmountCurrencyProduct === true &&
      evidenceSnapshot.confirmedCurrentlyPaidAndNotRefunded === true,
  );

  const claim = attempt.providerClaims.find(
    (row) =>
      row.paymentProvider === "RIPPLE" &&
      row.providerPaymentId === input.providerPaymentId &&
      row.attemptId === attempt.id &&
      row.paymentId === payment.id &&
      row.source === "ADMIN_PROVIDER_ATTESTATION",
  );
  if (!claim) throw new Error("Provider payment claim is missing for failed Ripple receipt");

  const payer = await tx.user.findUnique({
    where: { id: attempt.userId },
    select: { email: true },
  });
  if (!payer?.email) throw new Error("Checkout payer account is missing for failed Ripple receipt");

  const eventAt = input.providerEventAt.getTime();
  requireMatch(
    eventAt >= attempt.createdAt.getTime() - 5_000 &&
      eventAt <= attempt.confirmedAt.getTime() + 5 * 60_000,
  );
  const clientId = getRippleClientId();
  for (const receipt of unresolved) {
    requireMatch(
      (receipt.status === "FAILED" && receipt.lastErrorCode === "MISSING_REFERENCE") ||
        (receipt.status === "QUARANTINED" && receipt.lastErrorCode === "RECONCILED_PAYMENT"),
    );
    requireMatch(receipt.merchantReference === null);
    requireMatch(receipt.processedAt === null);
    requireMatch(receipt.clientId === clientId);
    requireMatch(receipt.linkCode === attempt.productCode);
    requireMatch(receipt.recurring === false && receipt.linkType === "one-off");
    requireMatch(receipt.amountPence === attempt.amountPence);
    requireMatch(receipt.currency?.toLowerCase() === attempt.currency);
    requireMatch(receipt.customerEmailNorm !== null);
    requireMatch(
      normalizeRippleEmail(receipt.customerEmailNorm ?? "") ===
        normalizeRippleEmail(payer.email),
    );
    requireMatch(sameSecond(receipt.eventTimestamp.getTime(), eventAt));

    const payload = payloadAs(receipt.minimizedPayload);
    if (!payload) throw new Error("Failed Ripple receipt payload is invalid");
    const payloadAt = Date.parse(payload.timestamp);
    requireMatch(
      Number.isFinite(payloadAt) &&
        payloadAt === receipt.eventTimestamp.getTime() &&
        sameSecond(payloadAt, eventAt),
    );
    requireMatch(
      payload.event === "payment.received" &&
        payload.client_id === clientId &&
        payload.payment_reference === input.providerPaymentId &&
        payload.merchant_reference === null &&
        payload.link_code === attempt.productCode &&
        parsePoundsToPence(payload.amount) === attempt.amountPence &&
        payload.currency?.toLowerCase() === attempt.currency &&
        payload.recurring === false &&
        payload.link_type === "one-off",
    );
  }

  const supersededIds: string[] = [];
  for (const receipt of unresolved) {
    if (receipt.status === "QUARANTINED") continue;
    const updated = await tx.paymentWebhookInbox.updateMany({
      where: {
        id: receipt.id,
        updatedAt: receipt.updatedAt,
        paymentReference: input.providerPaymentId,
        eventType: "payment.received",
        merchantReference: null,
        status: "FAILED",
        lastErrorCode: "MISSING_REFERENCE",
        attemptCount: receipt.attemptCount,
      },
      data: {
        status: "QUARANTINED",
        lastErrorCode: "RECONCILED_PAYMENT",
      },
    });
    requireMatch(updated.count === 1);
    supersededIds.push(receipt.id);
    await logAdminAction(
      {
        adminId: input.adminId,
        action: "SUPERSEDE_RIPPLE_INBOX_BY_RECONCILIATION",
        entityType: "PaymentWebhookInbox",
        entityId: receipt.id,
        details: {
          disposition: "SUPERSEDED_BY_ADMIN_PROVIDER_ATTESTATION",
          previousStatus: "FAILED",
          previousErrorCode: "MISSING_REFERENCE",
          resultingStatus: "QUARANTINED",
          resultingErrorCode: "RECONCILED_PAYMENT",
          paymentId: payment.id,
          attemptId: attempt.id,
          providerPaymentId: input.providerPaymentId,
          evidenceId: input.evidenceId,
          providerEventAt: input.providerEventAt.toISOString(),
          processedAtPreserved: true,
        },
      },
      tx,
    );
  }

  return supersededIds;
}
