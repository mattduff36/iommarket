"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  cancelProviderSubscription,
  getPaymentProviderCapabilities,
  refundProviderPayment,
} from "@/lib/payments/provider";
import { lockProviderPayment } from "@/lib/payments/webhook-subscriptions";
import { applyRecordedChargeRefund } from "@/lib/payments/subscription-refund";
import { runPaymentSerializable } from "@/lib/payments/transaction";
import {
  getPaymentDisplayId,
  getSubscriptionDisplayId,
} from "@/lib/payments/records";
import { captureException } from "@/lib/monitoring";
import {
  searchPaymentsSchema,
  refundPaymentSchema,
  refundSubscriptionPaymentSchema,
  cancelSubscriptionSchema,
  attachUnmatchedListingSchema,
  reconcileRipplePaymentSchema,
  type SearchPaymentsInput,
  type RefundPaymentInput,
  type RefundSubscriptionPaymentInput,
  type CancelSubscriptionInput,
  type AttachUnmatchedListingInput,
  type ReconcileRipplePaymentInput,
} from "@/lib/validations/admin";
import {
  AttachUnmatchedListingError,
  attachUnmatchedListingPayment,
} from "@/lib/payments/attach-unmatched-listing";
import type { Prisma } from "@prisma/client";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { applySamplePaymentVisibility } from "@/lib/listings/sample-related-visibility";
import {
  PaymentReconciliationError,
  reconcileListingPayment,
} from "@/lib/payments/reconcile-payment";

export async function searchPayments(input: SearchPaymentsInput) {
  await requireRole("ADMIN");

  const parsed = searchPaymentsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { query, status, page, pageSize } = parsed.data;

  const where: Prisma.PaymentWhereInput = {};
  if (query) {
    where.OR = [
      { providerPaymentId: { contains: query } },
      { providerReference: { contains: query } },
      { stripePaymentId: { contains: query } },
      { listing: { title: { contains: query, mode: "insensitive" } } },
      { listingId: query },
    ];
  }
  if (status) where.status = status;
  const visibleWhere = applySamplePaymentVisibility(
    where,
    await getSampleVisibility(),
  );

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where: visibleWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        listing: { select: { title: true, userId: true, user: { select: { email: true } } } },
      },
    }),
    db.payment.count({ where: visibleWhere }),
  ]);

  return {
    data: { payments, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function adminRefundPayment(input: RefundPaymentInput) {
  const admin = await requireRole("ADMIN");

  const parsed = refundPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payment = await db.payment.findUnique({ where: { id: parsed.data.paymentId } });
  if (!payment) return { error: "Payment not found" };
  if (payment.status !== "SUCCEEDED") return { error: "Only succeeded payments can be refunded" };

  try {
    const providerPaymentId = payment.providerPaymentId ?? payment.stripePaymentId;
    if (!providerPaymentId) {
      return { error: "Payment provider reference is missing" };
    }
    await refundProviderPayment(providerPaymentId);

    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUNDED",
        refundReason: parsed.data.reason,
        refundedAt: new Date(),
      },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "REFUND_PAYMENT",
      entityType: "Payment",
      entityId: payment.id,
      details: {
        paymentProvider: payment.paymentProvider,
        providerPaymentId: getPaymentDisplayId(payment),
        amount: payment.amount,
        reason: parsed.data.reason,
        notes: parsed.data.notes ?? null,
      },
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    return { data: { refunded: true } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "adminRefundPayment",
      route: "/admin/payments",
      requestPath: "/admin/payments",
      userId: admin.id,
      tags: {
        paymentId: payment.id,
        paymentProvider: payment.paymentProvider,
        providerPaymentId: getPaymentDisplayId(payment),
      },
    });
    const message = err instanceof Error ? err.message : "Failed to process refund";
    return { error: message };
  }
}

export async function adminRefundSubscriptionPayment(
  input: RefundSubscriptionPaymentInput
) {
  const admin = await requireRole("ADMIN");

  const parsed = refundSubscriptionPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const sub = await db.subscription.findUnique({
    where: { id: parsed.data.subscriptionId },
  });
  if (!sub) return { error: "Subscription not found" };
  if (sub.source === "ADMIN_GRANT") {
    return { error: "Free admin grants do not have payments to refund." };
  }

  if (!sub.providerSubscriptionId && !sub.stripeSubscriptionId) {
    return { error: "Subscription provider reference is missing" };
  }

  const operationKey = `admin:${parsed.data.operationId}`;

  try {
    const charge = await db.subscriptionCharge.findUnique({
      where: { id: parsed.data.chargeId },
    });
    if (!charge || charge.subscriptionId !== sub.id) {
      return { error: "That payment does not belong to this subscription." };
    }
    if (charge.refundedAt) {
      return {
        data: { refunded: true, alreadyRecorded: true, chargeId: charge.id },
      };
    }

    const capabilities = getPaymentProviderCapabilities();
    const claim = await runPaymentSerializable(async (tx) => {
      await lockProviderPayment(tx, charge.paymentReference);
      const current = await tx.subscriptionCharge.findUnique({
        where: { id: charge.id },
      });
      if (!current || current.subscriptionId !== sub.id) {
        return { error: "That payment does not belong to this subscription." };
      }
      if (current.refundedAt) {
        return {
          data: { refunded: true, alreadyRecorded: true, chargeId: current.id },
        };
      }
      if (current.refundEventId && current.refundEventId !== operationKey) {
        return { error: "This payment is already bound to another refund confirmation." };
      }
      const operationOwner = await tx.subscriptionCharge.findFirst({
        where: { refundEventId: operationKey },
        select: { id: true },
      });
      if (operationOwner && operationOwner.id !== current.id) {
        return { error: "This refund confirmation is already bound to another payment." };
      }
      if (current.refundEventId !== operationKey) {
        await tx.subscriptionCharge.update({
          where: { id: current.id },
          data: { refundEventId: operationKey },
        });
        return { callProvider: capabilities.supportsInAppRefunds };
      }
      // Claimed but not yet refunded. Do not call the provider again.
      // Recording still proceeds; that gap is IN_APP_REFUND_PREREQUISITES.
      return { callProvider: false };
    });
    if ("error" in claim || "data" in claim) return claim;
    if (claim.callProvider) {
      try {
        await refundProviderPayment(charge.paymentReference);
      } catch (error) {
        await db.subscriptionCharge.updateMany({
          where: { id: charge.id, refundedAt: null, refundEventId: operationKey },
          data: { refundEventId: null },
        });
        throw error;
      }
    }
    const outcome = await runPaymentSerializable(async (tx) => {
      await lockProviderPayment(tx, charge.paymentReference);
      const current = await tx.subscriptionCharge.findUnique({
        where: { id: charge.id },
      });
      if (!current || current.subscriptionId !== sub.id) {
        return { error: "That payment does not belong to this subscription." };
      }
      if (current.refundedAt) {
        return {
          data: { refunded: true, alreadyRecorded: true, chargeId: current.id },
        };
      }
      await applyRecordedChargeRefund(tx, {
        chargeId: current.id,
        subscriptionId: sub.id,
        refundedAt: new Date(),
        refundEventId: operationKey,
        now: new Date(),
      });
      await logAdminAction({
        adminId: admin.id,
        action: "REFUND_SUBSCRIPTION_PAYMENT",
        entityType: "Subscription",
        entityId: sub.id,
        details: {
          paymentProvider: sub.paymentProvider,
          providerSubscriptionId: getSubscriptionDisplayId(sub),
          providerPaymentId: current.paymentReference,
          chargeId: current.id,
          operationId: parsed.data.operationId,
          amount: current.amount,
          currency: current.currency,
          reason: parsed.data.reason,
          notes: parsed.data.notes ?? null,
          inAppRefund: capabilities.supportsInAppRefunds,
        },
      }, tx);
      return { data: { refunded: true, chargeId: current.id } };
    }, 3, 20_000);

    if ("error" in outcome) return outcome;
    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    return outcome;
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "adminRefundSubscriptionPayment",
      route: "/admin/payments",
      requestPath: "/admin/payments",
      userId: admin.id,
      tags: {
        subscriptionId: sub.id,
        paymentProvider: sub.paymentProvider,
        providerSubscriptionId: getSubscriptionDisplayId(sub),
      },
    });
    const message = err instanceof Error ? err.message : "Failed to process refund";
    return { error: message };
  }
}

export async function adminCancelSubscription(input: CancelSubscriptionInput) {
  const admin = await requireRole("ADMIN");

  const parsed = cancelSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const sub = await db.subscription.findUnique({ where: { id: parsed.data.subscriptionId } });
  if (!sub) return { error: "Subscription not found" };
  if (sub.source === "ADMIN_GRANT") {
    return { error: "Manage free admin grants from the dealer access controls." };
  }
  if (sub.status === "CANCELLED") return { error: "Subscription already cancelled" };

  try {
    const providerSubscriptionId =
      sub.providerSubscriptionId ?? sub.stripeSubscriptionId;
    if (!providerSubscriptionId) {
      return { error: "Subscription provider reference is missing" };
    }
    await cancelProviderSubscription(providerSubscriptionId, parsed.data.immediately);

    await db.subscription.update({
      where: { id: sub.id },
      data: parsed.data.immediately
        ? { status: "CANCELLED", cancelAtPeriodEnd: false }
        : { cancelAtPeriodEnd: true },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "CANCEL_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: sub.id,
      details: {
        paymentProvider: sub.paymentProvider,
        providerSubscriptionId: getSubscriptionDisplayId(sub),
        immediately: parsed.data.immediately,
        reason: parsed.data.reason,
        notes: parsed.data.notes ?? null,
      },
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    return { data: { cancelled: true } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "adminCancelSubscription",
      route: "/admin/payments",
      requestPath: "/admin/payments",
      userId: admin.id,
      tags: {
        subscriptionId: sub.id,
        paymentProvider: sub.paymentProvider,
        providerSubscriptionId: getSubscriptionDisplayId(sub),
      },
    });
    const message = err instanceof Error ? err.message : "Failed to cancel subscription";
    return { error: message };
  }
}

export async function adminAttachUnmatchedListing(
  input: AttachUnmatchedListingInput,
) {
  const admin = await requireRole("ADMIN");

  const parsed = attachUnmatchedListingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    await logAdminAction({
      adminId: admin.id,
      action: "ATTACH_UNMATCHED_LISTING_PAYMENT_INTENT",
      entityType: "PaymentWebhookInbox",
      entityId: parsed.data.inboxId,
      details: {
        listingId: parsed.data.listingId,
        inboxId: parsed.data.inboxId,
        confirmedCurrentlyPaidAndNotRefunded:
          parsed.data.confirmedCurrentlyPaidAndNotRefunded,
      },
    });

    const result = await attachUnmatchedListingPayment(parsed.data);

    try {
      await logAdminAction({
        adminId: admin.id,
        action: "ATTACH_UNMATCHED_LISTING_PAYMENT",
        entityType: "PaymentWebhookInbox",
        entityId: result.inboxId,
        details: {
          listingId: result.listingId,
          inboxId: result.inboxId,
          merchantReference: result.merchantReference,
          amountPence: result.amountPence,
        },
      });
    } catch (auditError) {
      await captureException({
        source: "SERVER",
        error: auditError,
        action: "adminAttachUnmatchedListingAudit",
        route: "/admin/payments",
        requestPath: "/admin/payments",
        userId: admin.id,
        tags: {
          inboxId: result.inboxId,
          listingId: result.listingId,
        },
      });
    }

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    revalidatePath(`/sell/checkout?listing=${result.listingId}`);
    revalidatePath(`/listings/${result.listingId}`);
    return { data: result };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "adminAttachUnmatchedListing",
      route: "/admin/payments",
      requestPath: "/admin/payments",
      userId: admin.id,
      tags: {
        inboxId: parsed.data.inboxId,
        listingId: parsed.data.listingId,
      },
    });
    if (err instanceof AttachUnmatchedListingError) {
      return { error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to attach unmatched payment";
    return { error: message };
  }
}

export async function adminReconcileRipplePayment(
  input: ReconcileRipplePaymentInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = reconcileRipplePaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const evidenceSeed = JSON.stringify({
    paymentId: parsed.data.paymentId,
    providerPaymentId: parsed.data.providerPaymentId,
    providerEventAt: parsed.data.providerEventAt.toISOString(),
    adminId: admin.id,
    notes: parsed.data.notes,
  });
  const evidenceId = `admin:${crypto
    .createHash("sha256")
    .update(evidenceSeed)
    .digest("hex")}`;

  try {
    const result = await reconcileListingPayment({
      paymentId: parsed.data.paymentId,
      providerPaymentId: parsed.data.providerPaymentId,
      providerEventAt: parsed.data.providerEventAt,
      evidence: {
        type: "ADMIN_PROVIDER_ATTESTATION",
        evidenceId,
        adminId: admin.id,
        notes: parsed.data.notes,
        snapshot: {
          source: "RIPPLE_PORTAL",
          confirmedAmountCurrencyProduct:
            parsed.data.confirmedAmountCurrencyProduct,
          confirmedCurrentlyPaidAndNotRefunded:
            parsed.data.confirmedCurrentlyPaidAndNotRefunded,
        },
      },
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    revalidatePath(`/listings/${result.listingId}`);
    return { data: result };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "adminReconcileRipplePayment",
      route: "/admin/payments",
      requestPath: "/admin/payments",
      userId: admin.id,
      tags: { paymentId: parsed.data.paymentId },
    });
    return {
      error:
        error instanceof PaymentReconciliationError
          ? error.message
          : "Failed to reconcile Ripple payment",
    };
  }
}
