"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { refundPaymentIntent, cancelStripeSubscription } from "@/lib/payments/stripe";
import {
  searchPaymentsSchema,
  refundPaymentSchema,
  cancelSubscriptionSchema,
  type SearchPaymentsInput,
  type RefundPaymentInput,
  type CancelSubscriptionInput,
} from "@/lib/validations/admin";
import type { Prisma } from "@prisma/client";

export async function searchPayments(input: SearchPaymentsInput) {
  await requireRole("ADMIN");

  const parsed = searchPaymentsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { query, status, page, pageSize } = parsed.data;

  const where: Prisma.PaymentWhereInput = {};
  if (query) {
    where.OR = [
      { stripePaymentId: { contains: query } },
      { listing: { title: { contains: query, mode: "insensitive" } } },
      { listingId: query },
    ];
  }
  if (status) where.status = status;

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        listing: { select: { title: true, userId: true, user: { select: { email: true } } } },
      },
    }),
    db.payment.count({ where }),
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
    await refundPaymentIntent(payment.stripePaymentId);

    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED" },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "REFUND_PAYMENT",
      entityType: "Payment",
      entityId: payment.id,
      details: { stripePaymentId: payment.stripePaymentId, amount: payment.amount },
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    return { data: { refunded: true } };
  } catch (err) {
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
  if (sub.status === "CANCELLED") return { error: "Subscription already cancelled" };

  try {
    await cancelStripeSubscription(sub.stripeSubscriptionId, parsed.data.immediately);

    if (parsed.data.immediately) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELLED" },
      });
    }

    await logAdminAction({
      adminId: admin.id,
      action: "CANCEL_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: sub.id,
      details: { stripeSubscriptionId: sub.stripeSubscriptionId, immediately: parsed.data.immediately },
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/revenue");
    return { data: { cancelled: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel subscription";
    return { error: message };
  }
}
