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
) {
  const cycle = latestSucceededId ?? "initial";
  return `ripple-pending:${type}:${listingId}:${cycle}`;
}

export async function persistPendingListingPayment(input: {
  listingId: string;
  merchantReference: string;
  amountPence: number;
  type?: Extract<PaymentType, "LISTING" | "FEATURED">;
  allowNewAfterSucceeded?: boolean;
}): Promise<PersistPendingListingPaymentResult> {
  const type = input.type ?? "LISTING";
  const succeeded = await db.payment.findFirst({
    where: { listingId: input.listingId, type, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
  });
  if (succeeded && !input.allowNewAfterSucceeded) {
    return { payment: succeeded, alreadyPaid: true };
  }

  const idempotencyKey = pendingIdempotencyKey(
    type,
    input.listingId,
    succeeded?.id ?? null,
  );
  const sharedData = {
    paymentProvider: "RIPPLE" as const,
    providerReference: input.merchantReference,
    amount: input.amountPence,
    currency: "gbp",
    idempotencyKey,
  };

  const pending = await db.payment.findFirst({
    where: { listingId: input.listingId, type, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    const payment = await db.payment.update({
      where: { id: pending.id },
      data: sharedData,
    });
    return { payment, alreadyPaid: false };
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
      if (existing) {
        const payment = await db.payment.update({
          where: { id: existing.id },
          data: sharedData,
        });
        return { payment, alreadyPaid: false };
      }
    }
    throw error;
  }
}
