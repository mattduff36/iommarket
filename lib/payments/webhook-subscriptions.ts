import {
  Prisma,
  type PaymentCheckoutAttempt,
  type Subscription,
  type SubscriptionProviderLifecycle,
  type SubscriptionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { captureBusinessEvent } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import {
  addRippleBillingPeriod,
  laterDate,
} from "@/lib/payments/ripple-calendar";
import {
  assertRippleAmountMatchesProduct,
  getRippleClientId,
} from "@/lib/payments/ripple-config";
import type { RippleProduct } from "@/lib/payments/ripple-config";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import {
  listSyntheticSubscriptionIds,
  normalizeRippleEmail,
  parseRippleReference,
} from "@/lib/payments/ripple-reference";
import {
  applyRecordedChargeRefund,
  classifySubscriptionRefund,
  recomputeDealerTier,
} from "@/lib/payments/subscription-refund";
import { decideProviderEventApplication } from "@/lib/payments/webhook-ordering";
import { runPaymentSerializable } from "@/lib/payments/transaction";

interface ResolvedDealerSubscription {
  dealerId: string;
  emailNorm: string | null;
  product: Extract<RippleProduct, { checkoutType: "dealer_subscription" }>;
}

interface SubscriptionMutation {
  status?: SubscriptionStatus;
  cancelAtPeriodEnd?: boolean;
  providerLifecycle?: SubscriptionProviderLifecycle;
  currentPeriodEnd?: Date | null;
}

type PaymentDb = Prisma.TransactionClient | typeof db;

type SubscriptionWrite = {
  subscription: Subscription;
  applied: boolean;
};

class DuplicateSubscriptionChargeError extends Error {
  constructor() {
    super("Ripple subscription charge was already applied");
    this.name = "DuplicateSubscriptionChargeError";
  }
}

class SubscriptionChargeCollisionError extends Error {
  constructor() {
    super("Ripple subscription charge collision");
    this.name = "SubscriptionChargeCollisionError";
  }
}

async function runPaymentTransaction<T>(
  fn: (client: PaymentDb) => Promise<T>
): Promise<T> {
  return runPaymentSerializable((tx) => fn(tx));
}

function requireDealerProduct(
  event: NormalizedProviderWebhookEvent
): Extract<RippleProduct, { checkoutType: "dealer_subscription" }> {
  const product = resolveRippleProduct({
    linkCode: event.linkCode,
    packageName: event.packageName,
  });
  if (!product || product.checkoutType !== "dealer_subscription") {
    throw new Error("Unknown Ripple product");
  }
  return product;
}

async function resolveDealer(
  event: NormalizedProviderWebhookEvent,
  product: Extract<RippleProduct, { checkoutType: "dealer_subscription" }>,
  client: PaymentDb = db
): Promise<ResolvedDealerSubscription> {
  if (event.providerReference && !event.metadata.dealerId) {
    throw new Error("Invalid Ripple reference");
  }

  if (event.metadata.dealerId) {
    const dealer = await client.dealerProfile.findUnique({
      where: { id: event.metadata.dealerId },
      select: { id: true, user: { select: { email: true } } },
    });
    if (!dealer) {
      throw new Error("Subscription webhook missing dealer reference");
    }
    return {
      dealerId: dealer.id,
      emailNorm: event.customerEmail
        ? normalizeRippleEmail(event.customerEmail)
        : normalizeRippleEmail(dealer.user.email),
      product,
    };
  }

  if (!event.customerEmail) {
    throw new Error("Subscription webhook missing dealer reference");
  }

  const emailNorm = normalizeRippleEmail(event.customerEmail);
  const payerMatches = await client.subscription.findMany({
    where: {
      customerEmailNorm: emailNorm,
      providerPlanId: product.code,
      source: "PAYMENT",
    },
    select: { dealerId: true },
  });
  const payerDealerIds = [
    ...new Set(payerMatches.map((row) => row.dealerId)),
  ];
  if (payerDealerIds.length > 1) {
    throw new Error("Ambiguous dealer email correlation");
  }
  if (payerDealerIds.length === 1) {
    return { dealerId: payerDealerIds[0], emailNorm, product };
  }

  const matches = await client.user.findMany({
    where: {
      email: { equals: emailNorm, mode: "insensitive" },
      deletedAt: null,
      disabledAt: null,
      dealerProfile: { isNot: null },
    },
    select: { dealerProfile: { select: { id: true } } },
  });
  const dealerIds = matches
    .map((user) => user.dealerProfile?.id)
    .filter((id): id is string => Boolean(id));
  if (dealerIds.length !== 1) {
    throw new Error("Ambiguous dealer email correlation");
  }

  return { dealerId: dealerIds[0], emailNorm, product };
}

async function findSubscription(
  resolved: ResolvedDealerSubscription,
  client: PaymentDb = db
): Promise<Subscription | null> {
  const syntheticIds = resolved.emailNorm
    ? listSyntheticSubscriptionIds({
        clientId: getRippleClientId(),
        linkCode: resolved.product.code,
        email: resolved.emailNorm,
      })
    : [];

  if (syntheticIds.length > 0) {
    const bySynthetic = await client.subscription.findFirst({
      where: { providerSubscriptionId: { in: syntheticIds } },
    });
    if (bySynthetic) return bySynthetic;
  }

  return client.subscription.findFirst({
    where: {
      dealerId: resolved.dealerId,
      source: "PAYMENT",
      providerPlanId: resolved.product.code,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveSubscriptionAttempt(
  event: NormalizedProviderWebhookEvent,
  resolved: ResolvedDealerSubscription,
  existing: Subscription | null,
  client: PaymentDb,
): Promise<{
  attempt: PaymentCheckoutAttempt | null;
  alreadyConfirmed: boolean;
}> {
  const eligibleStatuses = ["OPEN", "RETURNED", "REVIEW"] as const;
  let attempt: PaymentCheckoutAttempt | null = null;
  if (event.providerReference) {
    attempt = await client.paymentCheckoutAttempt.findUnique({
      where: { merchantReference: event.providerReference },
    });
    if (!attempt) {
      throw new Error("Subscription payment reference has no checkout attempt");
    }
  } else {
    if (
      existing &&
      isPaidSubscriptionEntitled(
        existing,
        event.eventTimestamp ?? new Date(),
      )
    ) {
      return { attempt: null, alreadyConfirmed: false };
    }
    const candidates = await client.paymentCheckoutAttempt.findMany({
      where: {
        dealerId: resolved.dealerId,
        kind: "DEALER_SUBSCRIPTION",
        productCode: resolved.product.code,
        tier: resolved.product.tier,
        amountPence: resolved.product.amountPence,
        currency: "gbp",
        status: { in: [...eligibleStatuses] },
      },
      take: 2,
      orderBy: { createdAt: "desc" },
    });
    if (candidates.length === 1) attempt = candidates[0];
    if (candidates.length !== 1) {
      throw new Error(
        "Initial subscription payment has no unique persisted checkout attempt",
      );
    }
  }

  if (!attempt) return { attempt: null, alreadyConfirmed: false };
  if (attempt.status === "FAILED" && event.providerPaymentId && existing) {
    const refundedCharge = await client.subscriptionCharge.findUnique({
      where: { paymentReference: event.providerPaymentId },
      select: {
        subscriptionId: true,
        refundedAt: true,
        amount: true,
        currency: true,
      },
    });
    if (
      refundedCharge?.refundedAt &&
      refundedCharge.subscriptionId === existing.id &&
      refundedCharge.amount === event.amount &&
      refundedCharge.currency.toLowerCase() ===
        (event.currency ?? "gbp").toLowerCase()
    ) {
      return { attempt, alreadyConfirmed: true };
    }
  }
  await client.$queryRaw`
    SELECT "id"
    FROM "PaymentCheckoutAttempt"
    WHERE "id" = ${attempt.id}
    FOR UPDATE
  `;
  attempt = await client.paymentCheckoutAttempt.findUnique({
    where: { id: attempt.id },
  });
  if (!attempt) {
    throw new Error("Subscription payment reference has no checkout attempt");
  }
  const dealer = await client.dealerProfile.findUnique({
    where: { id: resolved.dealerId },
    select: { userId: true },
  });
  let claims;
  try {
    claims = parseRippleReference(
      attempt.merchantReference,
      resolved.product.code,
    );
  } catch {
    throw new Error("Invalid subscription checkout attempt reference");
  }
  if (
    !dealer ||
    attempt.kind !== "DEALER_SUBSCRIPTION" ||
    attempt.dealerId !== resolved.dealerId ||
    attempt.userId !== dealer.userId ||
    attempt.productCode !== resolved.product.code ||
    attempt.tier !== resolved.product.tier ||
    attempt.amountPence !== resolved.product.amountPence ||
    attempt.currency !== "gbp" ||
    ![...eligibleStatuses, "CONFIRMED"].includes(attempt.status) ||
    !claims ||
    claims.purpose !== "dealer_subscription" ||
    claims.targetId !== resolved.dealerId ||
    claims.tier !== resolved.product.tier ||
    (event.providerReference &&
      event.providerReference !== attempt.merchantReference) ||
    event.amount !== attempt.amountPence ||
    event.currency?.toLowerCase() !== attempt.currency ||
    (event.eventTimestamp &&
      (event.eventTimestamp.getTime() < attempt.createdAt.getTime() - 5_000 ||
        event.eventTimestamp.getTime() >
          attempt.expiresAt.getTime() + 5 * 60_000))
  ) {
    throw new Error("Subscription checkout attempt does not match payment");
  }
  if (attempt.status === "CONFIRMED") {
    if (!event.providerPaymentId || !existing) {
      throw new Error("Confirmed subscription checkout cannot be replayed");
    }
    const [claim, reconciliation] = await Promise.all([
      client.providerPaymentClaim.findUnique({
        where: {
          paymentProvider_providerPaymentId: {
            paymentProvider: "RIPPLE",
            providerPaymentId: event.providerPaymentId,
          },
        },
        select: {
          attemptId: true,
          subscriptionCharge: { select: { subscriptionId: true } },
        },
      }),
      client.paymentReconciliation.findFirst({
        where: {
          attemptId: attempt.id,
          evidenceType: "VERIFIED_WEBHOOK",
          providerPaymentId: event.providerPaymentId,
        },
        select: { id: true },
      }),
    ]);
    if (
      claim?.attemptId !== attempt.id ||
      claim.subscriptionCharge?.subscriptionId !== existing.id ||
      !reconciliation
    ) {
      throw new Error("Confirmed subscription checkout cannot be replayed");
    }
  }
  return {
    attempt,
    alreadyConfirmed: attempt.status === "CONFIRMED",
  };
}

function eventMeta(event: NormalizedProviderWebhookEvent) {
  return {
    lastProviderEventAt: event.eventTimestamp ?? new Date(),
    lastProviderEventType: event.type,
    lastProviderEventFingerprint: event.fingerprint ?? event.id,
  };
}

function shouldApply(
  existing: Subscription | null,
  event: NormalizedProviderWebhookEvent
) {
  if (!existing) return "apply" as const;
  return decideProviderEventApplication({
    existingAt: existing.lastProviderEventAt,
    existingType: existing.lastProviderEventType,
    existingFingerprint: existing.lastProviderEventFingerprint,
    incomingAt: event.eventTimestamp ?? new Date(),
    incomingType: event.type,
    incomingFingerprint: event.fingerprint ?? event.id,
  });
}

export async function lockProviderPayment(
  client: PaymentDb,
  providerPaymentId: string,
) {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${providerPaymentId}, 0))
  `;
}

async function findSubscriptionRefundReceipt(providerPaymentId: string) {
  // This read is deliberately outside the serializable transaction. Its
  // snapshot can hide a refund row that committed while that transaction
  // waited for the provider-payment lock. The inbox insert takes the same
  // lock, so a separate read-committed read sees every refund committed
  // before entitlement is decided.
  return db.paymentWebhookInbox.findFirst({
    where: {
      paymentReference: providerPaymentId,
      eventType: "payment.refunded",
    },
    orderBy: { eventTimestamp: "asc" },
    select: { id: true, eventTimestamp: true, amountPence: true, currency: true },
  });
}

function isSubscriptionRefundEvent(event: NormalizedProviderWebhookEvent) {
  if (event.metadata.checkoutType === "dealer_subscription") return true;
  if (event.recurring === true || event.linkType === "recurring") return true;
  return (
    resolveRippleProduct({
      linkCode: event.linkCode,
      packageName: event.packageName,
    })?.checkoutType === "dealer_subscription"
  );
}

async function recordCharge(
  subscriptionId: string,
  event: NormalizedProviderWebhookEvent,
  attempt: PaymentCheckoutAttempt | null,
  client: PaymentDb = db,
  options?: { refundedAt?: Date },
) {
  if (!event.providerPaymentId || event.amount === null) {
    throw new Error("Recurring payment is missing payment_reference or amount");
  }
  const listingPayment = await client.payment.findUnique({
    where: { providerPaymentId: event.providerPaymentId },
    select: { id: true },
  });
  if (listingPayment) throw new SubscriptionChargeCollisionError();

  const claimed = await client.subscriptionCharge.createMany({
    data: [
      {
        subscriptionId,
        paymentReference: event.providerPaymentId,
        amount: event.amount,
        currency: event.currency ?? "gbp",
        eventTimestamp: event.eventTimestamp ?? new Date(),
        ...(options?.refundedAt
          ? {
              refundedAt: options.refundedAt,
              refundEventId: event.fingerprint ?? event.id,
            }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
  const charge = await client.subscriptionCharge.findUnique({
    where: { paymentReference: event.providerPaymentId },
    select: {
      id: true,
      subscriptionId: true,
      amount: true,
      currency: true,
    },
  });
  if (!charge) throw new SubscriptionChargeCollisionError();

  if (
    charge.subscriptionId !== subscriptionId ||
    charge.amount !== event.amount ||
    charge.currency.toLowerCase() !== (event.currency ?? "gbp").toLowerCase()
  ) {
    throw new SubscriptionChargeCollisionError();
  }

  const existingClaim = await client.providerPaymentClaim.findUnique({
    where: {
      paymentProvider_providerPaymentId: {
        paymentProvider: "RIPPLE",
        providerPaymentId: event.providerPaymentId,
      },
    },
  });
  if (
    existingClaim &&
    (existingClaim.subscriptionChargeId !== charge.id ||
      (attempt && existingClaim.attemptId !== attempt.id))
  ) {
    throw new SubscriptionChargeCollisionError();
  }
  if (!existingClaim) {
    try {
      await client.providerPaymentClaim.create({
        data: {
          paymentProvider: "RIPPLE",
          providerPaymentId: event.providerPaymentId,
          attemptId: attempt?.id,
          subscriptionChargeId: charge.id,
          source: "VERIFIED_WEBHOOK",
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new SubscriptionChargeCollisionError();
      }
      throw error;
    }
  }

  if (attempt) {
    const prior = await client.paymentReconciliation.findFirst({
      where: { attemptId: attempt.id },
    });
    if (
      prior &&
      (prior.evidenceType !== "VERIFIED_WEBHOOK" ||
        prior.providerPaymentId !== event.providerPaymentId)
    ) {
      throw new SubscriptionChargeCollisionError();
    }
    const evidenceId = event.fingerprint ?? event.id;
    const existingEvidence = await client.paymentReconciliation.findFirst({
      where: {
        attemptId: attempt.id,
        evidenceType: "VERIFIED_WEBHOOK",
        evidenceId,
      },
    });
    if (!existingEvidence) {
      await client.paymentReconciliation.create({
        data: {
          attemptId: attempt.id,
          evidenceType: "VERIFIED_WEBHOOK",
          evidenceId,
          providerPaymentId: event.providerPaymentId,
          providerEventAt: event.eventTimestamp ?? new Date(),
          evidenceSnapshot: {
            eventType: event.type,
            linkCode: event.linkCode ?? "",
            amountPence: event.amount,
            currency: event.currency ?? "",
            merchantReference: event.providerReference ?? "",
          },
        },
      });
    }
    await client.paymentCheckoutAttempt.update({
      where: { id: attempt.id },
      data: options?.refundedAt
        ? { status: "FAILED", failedAt: new Date() }
        : { status: "CONFIRMED", confirmedAt: new Date() },
    });
  }

  return claimed.count === 1;
}

async function isExistingChargeReplay(
  subscriptionId: string,
  event: NormalizedProviderWebhookEvent,
  attempt: PaymentCheckoutAttempt | null,
  client: PaymentDb,
) {
  if (!event.providerPaymentId || event.amount === null) {
    throw new Error("Recurring payment is missing payment_reference or amount");
  }
  const [charge, claim] = await Promise.all([
    client.subscriptionCharge.findUnique({
      where: { paymentReference: event.providerPaymentId },
      select: {
        id: true,
        subscriptionId: true,
        amount: true,
        currency: true,
      },
    }),
    client.providerPaymentClaim.findUnique({
      where: {
        paymentProvider_providerPaymentId: {
          paymentProvider: "RIPPLE",
          providerPaymentId: event.providerPaymentId,
        },
      },
    }),
  ]);
  if (!charge && !claim) return false;
  if (
    !charge ||
    !claim ||
    charge.subscriptionId !== subscriptionId ||
    charge.amount !== event.amount ||
    charge.currency.toLowerCase() !== (event.currency ?? "gbp").toLowerCase() ||
    claim.subscriptionChargeId !== charge.id ||
    (attempt && claim.attemptId !== attempt.id)
  ) {
    throw new SubscriptionChargeCollisionError();
  }
  return true;
}

async function ensureDealerRole(
  dealerId: string,
  client: PaymentDb = db,
  options: { explicitGrant?: boolean } = {},
) {
  const dealer = await client.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      userId: true,
      user: { select: { role: true } },
    },
  });
  if (!dealer) return;
  if (dealer.user.role === "ADMIN" || dealer.user.role === "DEALER") {
    return;
  }
  if (!options.explicitGrant) return;
  await client.user.update({
    where: { id: dealer.userId },
    data: { role: "DEALER" },
  });
}

async function upsertSubscription(
  resolved: ResolvedDealerSubscription,
  event: NormalizedProviderWebhookEvent,
  data: SubscriptionMutation,
  client: PaymentDb = db,
  options: { applyPaidEntitlement?: boolean } = {},
): Promise<SubscriptionWrite | null> {
  const existing = await findSubscription(resolved, client);
  const decision = shouldApply(existing, event);
  if (decision === "duplicate") {
    return existing ? { subscription: existing, applied: false } : null;
  }
  if (decision === "stale" || decision === "keep-conservative") {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "LOW",
      title: "Stale Ripple subscription event ignored",
      message: "A later or more conservative subscription event already exists.",
      action: "upsertSubscription",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: buildRippleSafeTags({
        decision,
        eventType: event.rawType,
      }),
    });
    if (!existing || !options.applyPaidEntitlement) {
      return existing ? { subscription: existing, applied: false } : null;
    }
    const subscription = await client.subscription.update({
      where: { id: existing.id },
      data: {
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
        paymentProvider: "RIPPLE",
        source: "PAYMENT",
        providerPlanId: resolved.product.code,
        customerEmailNorm: resolved.emailNorm,
      },
    });
    await ensureDealerRole(resolved.dealerId, client, {
      explicitGrant: existing.status === "INCOMPLETE",
    });
    await recomputeDealerTier(resolved.dealerId, new Date(), client);
    return { subscription, applied: true };
  }

  const providerSubscriptionId =
    existing?.providerSubscriptionId ??
    (resolved.emailNorm
      ? listSyntheticSubscriptionIds({
          clientId: getRippleClientId(),
          linkCode: resolved.product.code,
          email: resolved.emailNorm,
        })[0]
      : null);

  const subscription = existing
    ? await client.subscription.update({
        where: { id: existing.id },
        data: {
          ...data,
          paymentProvider: "RIPPLE",
          source: "PAYMENT",
          providerSubscriptionId,
          providerPlanId: resolved.product.code,
          customerEmailNorm: resolved.emailNorm,
          ...eventMeta(event),
        },
      })
    : await client.subscription.create({
        data: {
          dealerId: resolved.dealerId,
          paymentProvider: "RIPPLE",
          source: "PAYMENT",
          providerSubscriptionId,
          providerPlanId: resolved.product.code,
          customerEmailNorm: resolved.emailNorm,
          status: "INCOMPLETE",
          cancelAtPeriodEnd: false,
          ...data,
          ...eventMeta(event),
        },
      });

  if (data.status === "ACTIVE") {
    const explicitGrant = !existing || existing.status === "INCOMPLETE";
    await ensureDealerRole(resolved.dealerId, client, { explicitGrant });
  }
  await recomputeDealerTier(resolved.dealerId, new Date(), client);
  return { subscription, applied: true };
}

async function recordRefundedSubscriptionCharge(
  resolved: ResolvedDealerSubscription,
  event: NormalizedProviderWebhookEvent,
  existing: Subscription | null,
  attempt: PaymentCheckoutAttempt | null,
  refundedAt: Date,
  client: PaymentDb,
) {
  const providerSubscriptionId =
    existing?.providerSubscriptionId ??
    (resolved.emailNorm
      ? listSyntheticSubscriptionIds({
          clientId: getRippleClientId(),
          linkCode: resolved.product.code,
          email: resolved.emailNorm,
        })[0]
      : null);
  const subscription =
    existing ??
    (await client.subscription.create({
      data: {
        dealerId: resolved.dealerId,
        paymentProvider: "RIPPLE",
        source: "PAYMENT",
        providerSubscriptionId,
        providerPlanId: resolved.product.code,
        customerEmailNorm: resolved.emailNorm,
        status: "INCOMPLETE",
        cancelAtPeriodEnd: false,
      },
    }));
  if (!(await recordCharge(subscription.id, event, attempt, client, { refundedAt }))) {
    throw new DuplicateSubscriptionChargeError();
  }
}

async function applyRecurringPayment(event: NormalizedProviderWebhookEvent) {
  const product = requireDealerProduct(event);
  assertRippleAmountMatchesProduct(product, event.amount);
  try {
    await runPaymentTransaction(async (client) => {
      if (event.providerPaymentId) {
        await lockProviderPayment(client, event.providerPaymentId);
      }
      const resolved = await resolveDealer(event, product, client);
      const existing = await findSubscription(resolved, client);
      const { attempt, alreadyConfirmed } = await resolveSubscriptionAttempt(
        event,
        resolved,
        existing,
        client,
      );
      if (alreadyConfirmed) return;
      if (
        existing &&
        (await isExistingChargeReplay(existing.id, event, attempt, client))
      ) {
        return;
      }
      const refundReceipt = event.providerPaymentId
        ? await findSubscriptionRefundReceipt(event.providerPaymentId)
        : null;
      if (refundReceipt) {
        const classification = classifySubscriptionRefund({
          chargeAmount: event.amount ?? Number.NaN,
          chargeCurrency: event.currency ?? "",
          refundAmount: refundReceipt.amountPence,
          refundCurrency: refundReceipt.currency,
        });
        if (classification.kind === "full") {
          await recordRefundedSubscriptionCharge(
            resolved,
            event,
            existing,
            attempt,
            refundReceipt.eventTimestamp,
            client,
          );
          return;
        }
        await captureBusinessEvent({
          source: "WEBHOOK",
          severity: "HIGH",
          title: "Subscription refund was not applied",
          message: "A refund received before its charge does not match the full payment.",
          action: "applyRecurringPayment",
          route: "/api/webhooks/payments",
          requestPath: "/api/webhooks/payments",
          tags: { refundClassification: classification.kind },
        });
      }
      const periodEnd = laterDate(
        existing?.currentPeriodEnd,
        addRippleBillingPeriod(event.eventTimestamp ?? new Date(), product),
      );
      const result = await upsertSubscription(
        resolved,
        event,
        {
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          providerLifecycle: "ACTIVE",
          currentPeriodEnd: periodEnd,
        },
        client,
        { applyPaidEntitlement: true },
      );
      if (
        result?.applied &&
        !(await recordCharge(result.subscription.id, event, attempt, client))
      ) {
        throw new DuplicateSubscriptionChargeError();
      }
    });
  } catch (error) {
    if (error instanceof DuplicateSubscriptionChargeError) return;
    throw error;
  }
}

export async function handleRecurringPaymentReceived(
  event: NormalizedProviderWebhookEvent,
) {
  await applyRecurringPayment(event);
}

export async function handleRecurringPaymentSuccess(
  event: NormalizedProviderWebhookEvent,
) {
  await applyRecurringPayment(event);
}

export async function handleRecurringPaymentFailed(
  event: NormalizedProviderWebhookEvent
) {
  const product = requireDealerProduct(event);
  await runPaymentTransaction(async (client) => {
    const resolved = await resolveDealer(event, product, client);
    await upsertSubscription(
      resolved,
      event,
      {
        status: "PAST_DUE",
        providerLifecycle: "ACTIVE",
      },
      client
    );
  });
}

export async function handleSubscriptionCreated(
  event: NormalizedProviderWebhookEvent
) {
  const product = requireDealerProduct(event);
  await runPaymentTransaction(async (client) => {
    const resolved = await resolveDealer(event, product, client);
    const existing = await findSubscription(resolved, client);
    if (existing && isPaidSubscriptionEntitled(existing)) return;
    await upsertSubscription(
      resolved,
      event,
      {
        status: existing?.status === "ACTIVE" ? existing.status : "INCOMPLETE",
        providerLifecycle: "CREATED",
        currentPeriodEnd: existing?.currentPeriodEnd,
      },
      client
    );
  });
}

async function cancelByProviderSubscriptionId(
  event: NormalizedProviderWebhookEvent
) {
  if (!event.providerSubscriptionId) return false;
  const existing = await db.subscription.findFirst({
    where: { providerSubscriptionId: event.providerSubscriptionId },
  });
  if (!existing) return false;
  await db.subscription.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", cancelAtPeriodEnd: false },
  });
  const { reconcileCancellationForSubscription } = await import(
    "@/lib/policy/cancellation"
  );
  await reconcileCancellationForSubscription(existing.id, "WEBHOOK");
  return true;
}

export async function handleSubscriptionPausedOrCancelled(
  event: NormalizedProviderWebhookEvent,
  lifecycle: "PAUSED" | "CANCELLED"
) {
  const product = resolveRippleProduct({
    linkCode: event.linkCode,
    packageName: event.packageName,
  });
  if (!product || product.checkoutType !== "dealer_subscription") {
    if (lifecycle === "CANCELLED" && (await cancelByProviderSubscriptionId(event))) {
      return;
    }
    throw new Error("Unknown Ripple product");
  }
  await runPaymentTransaction(async (client) => {
    const resolved = await resolveDealer(event, product, client);
    const existing = await findSubscription(resolved, client);
    const now = event.eventTimestamp ?? new Date();
    const stillPaid =
      existing?.currentPeriodEnd &&
      existing.currentPeriodEnd.getTime() > now.getTime();

    await upsertSubscription(
      resolved,
      event,
      {
        status: stillPaid ? "ACTIVE" : "CANCELLED",
        cancelAtPeriodEnd: Boolean(stillPaid),
        providerLifecycle: lifecycle,
        currentPeriodEnd: existing?.currentPeriodEnd,
      },
      client
    );
  });
  if (lifecycle === "CANCELLED") {
    const { reconcileCancellationForSubscription } = await import(
      "@/lib/policy/cancellation"
    );
    const resolved = await resolveDealer(event, product);
    const existing = await findSubscription(resolved);
    if (existing) {
      await reconcileCancellationForSubscription(existing.id, "WEBHOOK");
    }
  }
}

export async function handleSubscriptionResumed(
  event: NormalizedProviderWebhookEvent
) {
  const product = requireDealerProduct(event);
  await runPaymentTransaction(async (client) => {
    const resolved = await resolveDealer(event, product, client);
    const existing = await findSubscription(resolved, client);
    const now = event.eventTimestamp ?? new Date();
    const stillPaid =
      existing?.currentPeriodEnd &&
      existing.currentPeriodEnd.getTime() > now.getTime();

    await upsertSubscription(
      resolved,
      event,
      {
        status: stillPaid
          ? "ACTIVE"
          : existing?.status === "ACTIVE"
            ? "PAST_DUE"
            : "INCOMPLETE",
        cancelAtPeriodEnd: false,
        providerLifecycle: "ACTIVE",
        currentPeriodEnd: existing?.currentPeriodEnd,
      },
      client
    );
  });
}

export async function handleSubscriptionRefundSchedule(
  event: NormalizedProviderWebhookEvent
) {
  if (!event.providerPaymentId) return null;
  const providerPaymentId = event.providerPaymentId;

  return runPaymentTransaction(async (client) => {
    await lockProviderPayment(client, providerPaymentId);
    const charge = await client.subscriptionCharge.findUnique({
      where: { paymentReference: providerPaymentId },
      select: {
        id: true,
        subscriptionId: true,
        refundedAt: true,
        eventTimestamp: true,
        amount: true,
        currency: true,
      },
    });
    if (!charge) {
      if (isSubscriptionRefundEvent(event)) {
        throw new Error("Subscription refund is waiting for its charge");
      }
      return null;
    }

    if (!charge.refundedAt) {
      const classification = classifySubscriptionRefund({
        chargeAmount: charge.amount,
        chargeCurrency: charge.currency,
        refundAmount: event.amount,
        refundCurrency: event.currency,
      });
      if (classification.kind !== "full") {
        await captureBusinessEvent({
          source: "WEBHOOK",
          severity: "HIGH",
          title: "Subscription refund was not applied",
          message: "The Ripple refund amount does not match the full stored charge.",
          action: "handleSubscriptionRefundSchedule",
          route: "/api/webhooks/payments",
          requestPath: "/api/webhooks/payments",
          tags: { refundClassification: classification.kind },
        });
        return { id: charge.subscriptionId, refundClassification: classification.kind };
      }
    }

    return applyRecordedChargeRefund(client, {
      chargeId: charge.id,
      subscriptionId: charge.subscriptionId,
      refundedAt: charge.refundedAt ?? event.eventTimestamp ?? new Date(),
      refundEventId: event.fingerprint ?? event.id ?? providerPaymentId,
      now: new Date(),
      recordCharge: !charge.refundedAt,
    });
  });
}
