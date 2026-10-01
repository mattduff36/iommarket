import { Prisma, type Payment, type PaymentType } from "@prisma/client";
import { db } from "@/lib/db";

export type PersistPendingListingPaymentResult = {
  payment: Payment;
  alreadyPaid: boolean;
};

function pendingIdempotencyKey(
  type: Extract<PaymentType, "LISTING" | "FEATURED">,
  listingId: string,
  latestSucceededId: string | null,
  latestFailedId: string | null,
  amountPence: number,
  includesFeatured: boolean,
) {
  const cycle = `${latestSucceededId ?? "initial"}:${latestFailedId ?? "none"}`;
  const featured = includesFeatured ? "with-featured" : "standard";
  return `ripple-pending:${type}:${listingId}:${cycle}:${amountPence}:${featured}`;
}

export async function persistPendingListingPayment(input: {
  listingId: string;
  merchantReference: string;
  amountPence: number;
  type?: Extract<PaymentType, "LISTING" | "FEATURED">;
  allowNewAfterSucceeded?: boolean;
  includesFeatured?: boolean;
}): Promise<PersistPendingListingPaymentResult> {
  const type = input.type ?? "LISTING";
  const includesFeatured = input.includesFeatured ?? false;
  const succeeded = await db.payment.findFirst({
    where: { listingId: input.listingId, type, status: "SUCCEEDED", refundedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const failed = await db.payment.findFirst({
    where: { listingId: input.listingId, type, status: "FAILED", paymentProvider: "RIPPLE", amount: input.amountPence, includesFeatured },
    orderBy: { createdAt: "desc" },
  });
  if (succeeded && !input.allowNewAfterSucceeded) {
    return { payment: succeeded, alreadyPaid: true };
  }

  const idempotencyKey = pendingIdempotencyKey(
    type,
    input.listingId,
    succeeded?.id ?? null,
    failed?.id ?? null,
    input.amountPence,
    includesFeatured,
  );
  const sharedData = {
    paymentProvider: "RIPPLE" as const,
    providerReference: input.merchantReference,
    amount: input.amountPence,
    currency: "gbp",
    idempotencyKey,
    includesFeatured,
  };

  const pending = await db.payment.findFirst({
    where: {
      listingId: input.listingId,
      type,
      paymentProvider: "RIPPLE",
      amount: input.amountPence,
      includesFeatured,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    return { payment: pending, alreadyPaid: false };
  }

  try {
    const payment = await db.payment.create({
      data: {
        listingId: input.listingId,
        type,
        status: "PENDING",
        ...sharedData,
      },
    });
    return { payment, alreadyPaid: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.payment.findFirst({
        where: { idempotencyKey },
      });
      if (existing?.status === "SUCCEEDED") {
        return { payment: existing, alreadyPaid: true };
      }
      if (existing?.status === "PENDING") return { payment: existing, alreadyPaid: false };
      if (existing?.status === "FAILED") throw new Error("Payment attempt changed while checkout was opening. Please try again.");
    }
    throw error;
  }
}
