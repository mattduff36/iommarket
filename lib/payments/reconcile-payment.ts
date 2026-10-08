import { Prisma, type PaymentCheckoutKind } from "@prisma/client";
import { logAdminAction } from "@/lib/admin/audit";
import { applyPaidFeaturedEntitlement } from "@/lib/payments/featured-entitlement";
import {
  getRippleProductByLinkCode,
} from "@/lib/payments/ripple-mapping";
import { parseRippleReference } from "@/lib/payments/ripple-reference";
import { quarantineReconciledMissingReferenceReceipts } from "@/lib/payments/quarantine-reconciled-receipt";
import { runPaymentSerializable } from "@/lib/payments/transaction";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import type { ListingNotificationIntent } from "@/lib/listings/notification-intents";

type ReconciliationEvidence =
  | {
      type: "VERIFIED_WEBHOOK";
      evidenceId: string;
      snapshot: Prisma.InputJsonObject;
    }
  | {
      type: "ADMIN_PROVIDER_ATTESTATION";
      evidenceId: string;
      adminId: string;
      notes: string;
      snapshot: Prisma.InputJsonObject;
    };

export type ReconcileListingPaymentInput = {
  paymentId?: string;
  merchantReference?: string;
  providerPaymentId: string;
  providerEventAt: Date;
  evidence: ReconciliationEvidence;
  event?: NormalizedProviderWebhookEvent;
};

export class PaymentReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentReconciliationError";
  }
}

function expectedContract(kind: PaymentCheckoutKind) {
  switch (kind) {
    case "LISTING_PAYMENT":
      return {
        purpose: "listing_payment" as const,
        paymentType: "LISTING" as const,
        includesFeatured: false,
      };
    case "LISTING_AND_FEATURED":
      return {
        purpose: "listing_and_featured" as const,
        paymentType: "LISTING" as const,
        includesFeatured: true,
      };
    case "FEATURED_UPGRADE":
      return {
        purpose: "featured_upgrade" as const,
        paymentType: "FEATURED" as const,
        includesFeatured: false,
      };
    default:
      throw new PaymentReconciliationError(
        "Dealer subscriptions require subscription reconciliation",
      );
  }
}

function validateProviderEvidence(input: ReconcileListingPaymentInput) {
  if (!/^\d{1,64}$/.test(input.providerPaymentId)) {
    throw new PaymentReconciliationError("Invalid Ripple payment reference");
  }
  if (
    Number.isNaN(input.providerEventAt.getTime()) ||
    input.providerEventAt.getTime() > Date.now() + 5 * 60_000
  ) {
    throw new PaymentReconciliationError("Invalid provider payment timestamp");
  }
  if (!input.evidence.evidenceId.trim()) {
    throw new PaymentReconciliationError("Reconciliation evidence is required");
  }
  if (
    input.evidence.type === "ADMIN_PROVIDER_ATTESTATION" &&
    (input.evidence.notes.trim().length < 3 ||
      input.evidence.snapshot.confirmedAmountCurrencyProduct !== true ||
      input.evidence.snapshot.confirmedCurrentlyPaidAndNotRefunded !== true)
  ) {
    throw new PaymentReconciliationError(
      "Complete provider attestation is required",
    );
  }
}

export async function reconcileListingPaymentInTransaction(
  tx: Prisma.TransactionClient,
  input: ReconcileListingPaymentInput,
) {
    validateProviderEvidence(input);
    let attempt = await tx.paymentCheckoutAttempt.findFirst({
      where: input.paymentId
        ? { paymentId: input.paymentId }
        : { merchantReference: input.merchantReference },
      include: {
        payment: {
          include: {
            listing: { select: { id: true, userId: true } },
          },
        },
        reconciliations: true,
        providerClaims: true,
      },
    });
    if (attempt) {
      await tx.$queryRaw`
        SELECT "id"
        FROM "PaymentCheckoutAttempt"
        WHERE "id" = ${attempt.id}
        FOR UPDATE
      `;
      attempt = await tx.paymentCheckoutAttempt.findFirst({
        where: { id: attempt.id },
        include: {
          payment: {
            include: {
              listing: { select: { id: true, userId: true } },
            },
          },
          reconciliations: true,
          providerClaims: true,
        },
      });
    }
    if (!attempt?.payment || !attempt.listingId) {
      throw new PaymentReconciliationError("Checkout attempt was not found");
    }
    if (
      input.providerEventAt.getTime() <
      attempt.createdAt.getTime() - 5_000
    ) {
      throw new PaymentReconciliationError(
        "Provider payment predates the checkout attempt",
      );
    }

    const payment = attempt.payment;
    const contract = expectedContract(attempt.kind);
    const product = getRippleProductByLinkCode(attempt.productCode);
    if (
      !product ||
      product.checkoutType !== contract.purpose ||
      attempt.amountPence !== product.amountPence ||
      attempt.currency !== "gbp" ||
      payment.paymentProvider !== "RIPPLE" ||
      payment.providerReference !== attempt.merchantReference ||
      payment.listingId !== attempt.listingId ||
      payment.listing.userId !== attempt.userId ||
      payment.type !== contract.paymentType ||
      payment.includesFeatured !== contract.includesFeatured ||
      payment.amount !== attempt.amountPence ||
      payment.currency.toLowerCase() !== attempt.currency ||
      payment.refundedAt
    ) {
      throw new PaymentReconciliationError(
        "Checkout attempt does not match the stored payment contract",
      );
    }
    if (
      input.evidence.type === "ADMIN_PROVIDER_ATTESTATION" &&
      contract.purpose !== "featured_upgrade"
    ) {
      throw new PaymentReconciliationError(
        "Manual reconciliation is currently limited to Featured upgrades",
      );
    }
    if (
      input.evidence.type === "VERIFIED_WEBHOOK" &&
      (!input.event ||
        input.event.type !== "payment.received" ||
        input.event.paymentStatus !== "SUCCEEDED" ||
        input.event.providerPaymentId !== input.providerPaymentId ||
        input.event.providerReference !== attempt.merchantReference ||
        input.event.metadata.checkoutType !== contract.purpose ||
        input.event.metadata.listingId !== attempt.listingId ||
        input.event.amount !== attempt.amountPence ||
        input.event.currency?.toLowerCase() !== attempt.currency)
    ) {
      throw new PaymentReconciliationError(
        "Verified webhook does not match the checkout contract",
      );
    }

    const claims = parseRippleReference(
      attempt.merchantReference,
      attempt.productCode,
    );
    if (
      !claims ||
      claims.purpose !== contract.purpose ||
      claims.targetId !== attempt.listingId
    ) {
      throw new PaymentReconciliationError("Invalid signed merchant reference");
    }

    const priorReconciliation = attempt.reconciliations[0];
    if (priorReconciliation) {
      const identical =
        priorReconciliation.evidenceType === input.evidence.type &&
        priorReconciliation.evidenceId === input.evidence.evidenceId &&
        priorReconciliation.providerPaymentId === input.providerPaymentId;
      if (
        identical &&
        payment.status === "SUCCEEDED" &&
        payment.providerPaymentId === input.providerPaymentId
      ) {
        if (input.evidence.type === "ADMIN_PROVIDER_ATTESTATION") {
          await quarantineReconciledMissingReferenceReceipts(tx, {
            adminId: input.evidence.adminId,
            attemptId: attempt.id,
            evidenceId: input.evidence.evidenceId,
            providerEventAt: input.providerEventAt,
            providerPaymentId: input.providerPaymentId,
          });
        }
        return {
          paymentId: payment.id,
          listingId: payment.listingId,
          featuredApplied: Boolean(payment.featuredAppliedAt),
          idempotent: true,
        };
      }
      throw new PaymentReconciliationError(
        "This checkout was already reconciled with different evidence",
      );
    }

    if (payment.status !== "PENDING" || payment.providerPaymentId) {
      throw new PaymentReconciliationError(
        "Payment is no longer eligible for reconciliation",
      );
    }

    const adverseReceipt = await tx.paymentWebhookInbox.findFirst({
      where: {
        paymentReference: input.providerPaymentId,
        eventType: { not: "payment.received" },
      },
      select: { id: true },
    });
    if (adverseReceipt) {
      throw new PaymentReconciliationError(
        "Adverse provider evidence blocks reconciliation",
      );
    }

    const [paymentOwner, subscriptionOwner, providerClaim] = await Promise.all([
      tx.payment.findUnique({
        where: { providerPaymentId: input.providerPaymentId },
        select: { id: true },
      }),
      tx.subscriptionCharge.findUnique({
        where: { paymentReference: input.providerPaymentId },
        select: { id: true },
      }),
      tx.providerPaymentClaim.findUnique({
        where: {
          paymentProvider_providerPaymentId: {
            paymentProvider: "RIPPLE",
            providerPaymentId: input.providerPaymentId,
          },
        },
      }),
    ]);
    if (
      subscriptionOwner ||
      (paymentOwner && paymentOwner.id !== payment.id) ||
      providerClaim
    ) {
      throw new PaymentReconciliationError(
        "Ripple payment reference is already claimed",
      );
    }

    await tx.providerPaymentClaim.create({
      data: {
        paymentProvider: "RIPPLE",
        providerPaymentId: input.providerPaymentId,
        attemptId: attempt.id,
        paymentId: payment.id,
        source: input.evidence.type,
      },
    });
    await tx.paymentReconciliation.create({
      data: {
        attemptId: attempt.id,
        evidenceType: input.evidence.type,
        evidenceId: input.evidence.evidenceId,
        providerPaymentId: input.providerPaymentId,
        providerEventAt: input.providerEventAt,
        adminId:
          input.evidence.type === "ADMIN_PROVIDER_ATTESTATION"
            ? input.evidence.adminId
            : null,
        notes:
          input.evidence.type === "ADMIN_PROVIDER_ATTESTATION"
            ? input.evidence.notes
            : null,
        evidenceSnapshot: input.evidence.snapshot,
      },
    });

    const transitioned = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: "PENDING",
        providerPaymentId: null,
        refundedAt: null,
      },
      data: {
        status: "SUCCEEDED",
        providerPaymentId: input.providerPaymentId,
        lastProviderEventAt: input.providerEventAt,
        lastProviderEventType:
          input.evidence.type === "VERIFIED_WEBHOOK"
            ? "payment.received"
            : "admin.provider_attestation",
        lastProviderEventFingerprint: input.evidence.evidenceId,
      },
    });
    if (transitioned.count !== 1) {
      throw new PaymentReconciliationError(
        "Payment changed while reconciliation was in progress",
      );
    }

    let featuredApplied = false;
    let notifications: ListingNotificationIntent[] = [];
    if (contract.purpose === "featured_upgrade") {
      featuredApplied = await applyPaidFeaturedEntitlement(
        payment.listingId,
        tx,
        input.providerEventAt,
      );
    } else if (input.event) {
      const { submitPaidListingForReview } = await import(
        "@/lib/payments/webhook-payments"
      );
      notifications = await submitPaidListingForReview(
        payment.listingId,
        input.event,
        tx,
      );
    }

    await tx.paymentCheckoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    if (input.evidence.type === "ADMIN_PROVIDER_ATTESTATION") {
      const supersededInboxIds = await quarantineReconciledMissingReferenceReceipts(tx, {
        adminId: input.evidence.adminId,
        attemptId: attempt.id,
        evidenceId: input.evidence.evidenceId,
        providerEventAt: input.providerEventAt,
        providerPaymentId: input.providerPaymentId,
      });
      await logAdminAction(
        {
          adminId: input.evidence.adminId,
          action: "RECONCILE_RIPPLE_PAYMENT",
          entityType: "Payment",
          entityId: payment.id,
          details: {
            attemptId: attempt.id,
            providerPaymentId: input.providerPaymentId,
            providerEventAt: input.providerEventAt.toISOString(),
            merchantReference: attempt.merchantReference,
            amountPence: payment.amount,
            currency: payment.currency,
            featuredApplied,
            evidenceId: input.evidence.evidenceId,
            notes: input.evidence.notes,
            supersededInboxIds,
          },
        },
        tx,
      );
    }

    return {
      paymentId: payment.id,
      listingId: payment.listingId,
      featuredApplied,
      idempotent: false,
      notifications,
    };
}

async function reconcileOnce(input: ReconcileListingPaymentInput) {
  return runPaymentSerializable((tx) =>
    reconcileListingPaymentInTransaction(tx, input),
  );
}

export async function reconcileListingPayment(
  input: ReconcileListingPaymentInput,
) {
  validateProviderEvidence(input);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await reconcileOnce(input);
    } catch (error) {
      const uniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!uniqueConflict) throw error;
      if (attempt === 3) {
        throw new PaymentReconciliationError(
          "Payment reconciliation could not obtain a unique provider claim",
        );
      }
    }
  }
  throw new PaymentReconciliationError(
    "Payment reconciliation could not obtain a unique provider claim",
  );
}
