import type { PaymentCheckoutAttemptStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const OPEN_ATTEMPT_STATUSES = ["OPEN", "RETURNED", "REVIEW"] as const;

/**
 * Opening a hosted Ripple checkout stores an attempt and a placeholder
 * PENDING payment. That placeholder becomes an admin payment only after
 * provider activity exists.
 *
 * Provider activity is a checkout observation, reconciliation, provider
 * claim, provider payment id, provider event, or a webhook inbox row matched
 * by merchant reference. Attempt status and email are not evidence.
 */
export type PaymentActivityFacts = {
  paymentProvider: "STRIPE" | "RIPPLE" | "DEV" | "ADMIN";
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
  providerPaymentId: string | null;
  lastProviderEventAt: Date | null;
  hasProviderClaim: boolean;
  observationCount: number;
  reconciliationCount: number;
  attemptClaimCount: number;
  hasWebhookForMerchantReference: boolean;
};

export type CheckoutReviewFacts = {
  status: PaymentCheckoutAttemptStatus;
  observationCount: number;
  reconciliationCount: number;
  attemptClaimCount: number;
  paymentProviderPaymentId: string | null;
  paymentLastProviderEventAt: Date | null;
  paymentHasProviderClaim: boolean;
  hasWebhookForMerchantReference: boolean;
};

type PaymentVisibilityClient = {
  payment: {
    findMany: (args: {
      where: Prisma.PaymentWhereInput;
      select: { providerReference: true };
    }) => Promise<Array<{ providerReference: string | null }>>;
  };
  paymentWebhookInbox: {
    findMany: (args: {
      where: { merchantReference: { in: string[] } };
      select: { merchantReference: true };
      distinct: ["merchantReference"];
    }) => Promise<Array<{ merchantReference: string | null }>>;
  };
  paymentCheckoutAttempt: {
    findMany: (args: {
      where: Prisma.PaymentCheckoutAttemptWhereInput;
      select: { merchantReference: true };
    }) => Promise<Array<{ merchantReference: string }>>;
  };
};

export function hostedRipplePendingHasProviderActivity(
  facts: PaymentActivityFacts,
): boolean {
  return (
    Boolean(facts.providerPaymentId) ||
    Boolean(facts.lastProviderEventAt) ||
    facts.hasProviderClaim ||
    facts.observationCount > 0 ||
    facts.reconciliationCount > 0 ||
    facts.attemptClaimCount > 0 ||
    facts.hasWebhookForMerchantReference
  );
}

export function isUnobservedHostedRippleCheckout(
  facts: PaymentActivityFacts,
): boolean {
  if (facts.paymentProvider !== "RIPPLE" || facts.status !== "PENDING") return false;
  return !hostedRipplePendingHasProviderActivity(facts);
}

export function isVisibleAdminPayment(facts: PaymentActivityFacts): boolean {
  return !isUnobservedHostedRippleCheckout(facts);
}

export function checkoutNeedsManualReview(facts: CheckoutReviewFacts): boolean {
  const openAttempt = OPEN_ATTEMPT_STATUSES.some((status) => status === facts.status);
  if (!openAttempt) return false;
  return (
    facts.observationCount > 0 ||
    facts.reconciliationCount > 0 ||
    facts.attemptClaimCount > 0 ||
    Boolean(facts.paymentProviderPaymentId) ||
    Boolean(facts.paymentLastProviderEventAt) ||
    facts.paymentHasProviderClaim ||
    facts.hasWebhookForMerchantReference
  );
}

export function unobservedHostedRipplePaymentWhere(
  evidencedMerchantReferences: readonly string[] = [],
): Prisma.PaymentWhereInput {
  const noDurableEvidence: Prisma.PaymentWhereInput = {
    paymentProvider: "RIPPLE",
    status: "PENDING",
    providerPaymentId: null,
    lastProviderEventAt: null,
    providerClaim: { is: null },
    OR: [
      { checkoutAttempt: { is: null } },
      {
        checkoutAttempt: {
          is: {
            observations: { none: {} },
            reconciliations: { none: {} },
            providerClaims: { none: {} },
          },
        },
      },
    ],
  };
  if (evidencedMerchantReferences.length === 0) return noDurableEvidence;
  return {
    AND: [
      noDurableEvidence,
      {
        OR: [
          { providerReference: null },
          { providerReference: { notIn: [...evidencedMerchantReferences] } },
        ],
      },
    ],
  };
}

export function visibleAdminPaymentWhere(
  where: Prisma.PaymentWhereInput,
  evidencedMerchantReferences: readonly string[] = [],
): Prisma.PaymentWhereInput {
  return {
    AND: [
      where,
      { NOT: unobservedHostedRipplePaymentWhere(evidencedMerchantReferences) },
    ],
  };
}

export function manualReviewCheckoutAttemptWhere(
  webhookMerchantReferences: readonly string[] = [],
): Prisma.PaymentCheckoutAttemptWhereInput {
  const evidence: Prisma.PaymentCheckoutAttemptWhereInput[] = [
    { observations: { some: {} } },
    { reconciliations: { some: {} } },
    { providerClaims: { some: {} } },
    {
      payment: {
        is: {
          OR: [
            { providerPaymentId: { not: null } },
            { lastProviderEventAt: { not: null } },
            { providerClaim: { isNot: null } },
          ],
        },
      },
    },
  ];
  if (webhookMerchantReferences.length > 0) {
    evidence.push({
      merchantReference: { in: [...webhookMerchantReferences] },
    });
  }
  return {
    status: { in: [...OPEN_ATTEMPT_STATUSES] },
    OR: evidence,
  };
}

function uniqueReferences(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function evidencedWebhookMerchantReferences(
  references: readonly (string | null | undefined)[],
  client: Pick<PaymentVisibilityClient, "paymentWebhookInbox"> = db,
) {
  const merchantReferences = uniqueReferences(references);
  if (merchantReferences.length === 0) return [];
  const rows = await client.paymentWebhookInbox.findMany({
    where: { merchantReference: { in: merchantReferences } },
    select: { merchantReference: true },
    distinct: ["merchantReference"],
  });
  return uniqueReferences(rows.map((row) => row.merchantReference));
}

export async function resolveVisibleAdminPaymentWhere(
  where: Prisma.PaymentWhereInput,
  client: Pick<PaymentVisibilityClient, "payment" | "paymentWebhookInbox"> = db,
) {
  const candidates = await client.payment.findMany({
    where: {
      AND: [
        where,
        {
          paymentProvider: "RIPPLE",
          status: "PENDING",
          providerPaymentId: null,
          providerReference: { not: null },
        },
      ],
    },
    select: { providerReference: true },
  });
  const evidenced = await evidencedWebhookMerchantReferences(
    candidates.map((row) => row.providerReference),
    client,
  );
  return visibleAdminPaymentWhere(where, evidenced);
}

export async function resolveManualReviewAttemptWhere(
  client: Pick<PaymentVisibilityClient, "paymentCheckoutAttempt" | "paymentWebhookInbox"> = db,
) {
  const attempts = await client.paymentCheckoutAttempt.findMany({
    where: { status: { in: [...OPEN_ATTEMPT_STATUSES] } },
    select: { merchantReference: true },
  });
  const evidenced = await evidencedWebhookMerchantReferences(
    attempts.map((attempt) => attempt.merchantReference),
    client,
  );
  return manualReviewCheckoutAttemptWhere(evidenced);
}
