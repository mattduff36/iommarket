import type {
  DealerTier,
  PaymentCheckoutAttempt,
  PaymentCheckoutKind,
  Prisma,
} from "@prisma/client";
import { runPaymentSerializable } from "@/lib/payments/transaction";

const ATTEMPT_LIFETIME_MS = 30 * 60_000;

type CheckoutAttemptInput = {
  userId: string;
  kind: PaymentCheckoutKind;
  merchantReference: string;
  productCode: string;
  amountPence: number;
  listingId?: string;
  dealerId?: string;
  paymentId?: string;
  tier?: DealerTier;
  now?: Date;
};

function runtimeEnvironment(): string {
  return process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || "unknown";
}

function assertAttemptShape(input: CheckoutAttemptInput) {
  const listingCheckout = input.kind !== "DEALER_SUBSCRIPTION";
  if (
    input.amountPence <= 0 ||
    !input.merchantReference.trim() ||
    !input.productCode.trim() ||
    (listingCheckout &&
      (!input.listingId || !input.paymentId || input.dealerId || input.tier)) ||
    (!listingCheckout &&
      (!input.dealerId || input.listingId || input.paymentId || !input.tier))
  ) {
    throw new Error("Invalid payment checkout attempt");
  }
}

function sameContract(
  attempt: PaymentCheckoutAttempt,
  input: CheckoutAttemptInput,
): boolean {
  return (
    attempt.userId === input.userId &&
    attempt.kind === input.kind &&
    attempt.listingId === (input.listingId ?? null) &&
    attempt.dealerId === (input.dealerId ?? null) &&
    attempt.paymentId === (input.paymentId ?? null) &&
    attempt.productCode === input.productCode &&
    attempt.amountPence === input.amountPence &&
    attempt.currency === "gbp" &&
    attempt.tier === (input.tier ?? null)
  );
}

async function findReusableAttempt(
  tx: Prisma.TransactionClient,
  input: CheckoutAttemptInput,
  now: Date,
) {
  if (input.paymentId) {
    return tx.paymentCheckoutAttempt.findUnique({
      where: { paymentId: input.paymentId },
    });
  }
  return tx.paymentCheckoutAttempt.findFirst({
    where: {
      userId: input.userId,
      dealerId: input.dealerId,
      kind: input.kind,
      productCode: input.productCode,
      amountPence: input.amountPence,
      currency: "gbp",
      tier: input.tier,
      status: "OPEN",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Persists the checkout contract before the browser leaves the site.
 * A still-open equivalent checkout is reused so repeated clicks do not create
 * competing merchant references.
 */
export async function persistCheckoutAttempt(
  input: CheckoutAttemptInput,
): Promise<PaymentCheckoutAttempt> {
  assertAttemptShape(input);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ATTEMPT_LIFETIME_MS);

  return runPaymentSerializable(async (tx) => {
    const existing = await findReusableAttempt(tx, input, now);
    if (existing) {
      if (!sameContract(existing, input)) {
        throw new Error("Existing checkout attempt does not match the payment contract");
      }
      if (existing.status !== "OPEN" || existing.expiresAt > now) {
        return existing;
      }
      return tx.paymentCheckoutAttempt.update({
        where: { id: existing.id },
        data: { status: "OPEN", expiresAt },
      });
    }

    return tx.paymentCheckoutAttempt.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        listingId: input.listingId,
        dealerId: input.dealerId,
        paymentId: input.paymentId,
        merchantReference: input.merchantReference,
        productCode: input.productCode,
        tier: input.tier,
        amountPence: input.amountPence,
        currency: "gbp",
        environment: runtimeEnvironment(),
        expiresAt,
      },
    });
  });
}

/**
 * Records a browser-provided payment job reference as an unverified
 * observation. It must never reserve the provider reference or grant access.
 */
export async function recordHostedReturnObservation(input: {
  merchantReference: string;
  userId: string;
  providerPaymentId: string;
  observedAt?: Date;
}) {
  if (!/^\d{1,64}$/.test(input.providerPaymentId)) {
    throw new Error("Invalid Ripple payment reference");
  }
  const observedAt = input.observedAt ?? new Date();
  return runPaymentSerializable(async (tx) => {
    if (!("paymentCheckoutAttempt" in tx)) return null;
    const attempt = await tx.paymentCheckoutAttempt.findUnique({
      where: { merchantReference: input.merchantReference },
      include: { observations: { select: { providerPaymentId: true } } },
    });
    if (!attempt || attempt.userId !== input.userId) return null;

    const conflicts = attempt.observations.some(
      (row) => row.providerPaymentId !== input.providerPaymentId,
    );
    await tx.paymentCheckoutObservation.upsert({
      where: {
        attemptId_providerPaymentId: {
          attemptId: attempt.id,
          providerPaymentId: input.providerPaymentId,
        },
      },
      create: {
        attemptId: attempt.id,
        providerPaymentId: input.providerPaymentId,
        observedAt,
      },
      update: {},
    });
    if (attempt.status !== "CONFIRMED") {
      await tx.paymentCheckoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: conflicts ? "REVIEW" : "RETURNED",
          returnedAt: attempt.returnedAt ?? observedAt,
        },
      });
    }
    return { attemptId: attempt.id, conflicts };
  });
}
