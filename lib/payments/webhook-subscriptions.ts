import {
  Prisma,
  type DealerTier,
  type Subscription,
  type SubscriptionProviderLifecycle,
  type SubscriptionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { captureBusinessEvent } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import {
  addClampedCalendarMonth,
  laterDate,
} from "@/lib/payments/ripple-calendar";
import {
  assertRippleAmountMatchesProduct,
  getRippleClientId,
} from "@/lib/payments/ripple-config";
import type { RippleProduct } from "@/lib/payments/ripple-config";
import {
  getDealerTierFromRippleProduct,
  resolveRippleProduct,
} from "@/lib/payments/ripple-mapping";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import {
  listSyntheticSubscriptionIds,
  normalizeRippleEmail,
} from "@/lib/payments/ripple-reference";
import { decideProviderEventApplication } from "@/lib/payments/webhook-ordering";

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
  return db.$transaction(async (tx) => fn(tx));
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

async function recordCharge(
  subscriptionId: string,
  event: NormalizedProviderWebhookEvent,
  client: PaymentDb = db
) {
  if (!event.providerPaymentId || event.amount === null) {
    throw new Error("Recurring payment is missing payment_reference or amount");
  }
  const claimed = await client.subscriptionCharge.createMany({
    data: [
      {
        subscriptionId,
        paymentReference: event.providerPaymentId,
        amount: event.amount,
        currency: event.currency ?? "gbp",
        eventTimestamp: event.eventTimestamp ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
  if (claimed.count === 1) return true;

  const existing = await client.subscriptionCharge.findUnique({
    where: { paymentReference: event.providerPaymentId },
    select: {
      subscriptionId: true,
      amount: true,
      currency: true,
    },
  });
  if (
    existing?.subscriptionId === subscriptionId &&
    existing.amount === event.amount &&
    existing.currency.toLowerCase() === (event.currency ?? "gbp").toLowerCase()
  ) {
    return false;
  }
  throw new SubscriptionChargeCollisionError();
}

async function recomputeDealerTier(
  dealerId: string,
  now = new Date(),
  client: PaymentDb = db
) {
  const subscriptions = await client.subscription.findMany({
    where: { dealerId, source: "PAYMENT" },
  });
  const entitledTiers = subscriptions
    .filter((subscription) => isPaidSubscriptionEntitled(subscription, now))
    .map((subscription) =>
      getDealerTierFromRippleProduct(
        resolveRippleProduct({
          linkCode: subscription.providerPlanId,
          packageName: subscription.providerPlanId,
        })
      )
    )
    .filter((tier): tier is DealerTier => Boolean(tier));

  if (entitledTiers.includes("PRO")) {
    await client.dealerProfile.update({
      where: { id: dealerId },
      data: { tier: "PRO" },
    });
    return;
  }
  if (entitledTiers.includes("STARTER")) {
    await client.dealerProfile.update({
      where: { id: dealerId },
      data: { tier: "STARTER" },
    });
  }
}

async function ensureDealerRole(dealerId: string, client: PaymentDb = db) {
  const dealer = await client.dealerProfile.findUnique({
    where: { id: dealerId },
    select: { userId: true },
  });
  if (!dealer) return;
  await client.user.update({
    where: { id: dealer.userId },
    data: { role: "DEALER" },
  });
}

async function upsertSubscription(
  resolved: ResolvedDealerSubscription,
  event: NormalizedProviderWebhookEvent,
  data: SubscriptionMutation,
  client: PaymentDb = db
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
    return existing ? { subscription: existing, applied: false } : null;
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
    await ensureDealerRole(resolved.dealerId, client);
  }
  await recomputeDealerTier(resolved.dealerId, new Date(), client);
  return { subscription, applied: true };
}

export async function handleRecurringPaymentReceived(
  event: NormalizedProviderWebhookEvent
) {
  const product = requireDealerProduct(event);
  assertRippleAmountMatchesProduct(product, event.amount);
  try {
    await runPaymentTransaction(async (client) => {
      const resolved = await resolveDealer(event, product, client);
      const existing = await findSubscription(resolved, client);
      const periodEnd = laterDate(
        existing?.currentPeriodEnd,
        addClampedCalendarMonth(event.eventTimestamp ?? new Date())
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
        client
      );
      if (
        result?.applied &&
        !(await recordCharge(result.subscription.id, event, client))
      ) {
        throw new DuplicateSubscriptionChargeError();
      }
    });
  } catch (error) {
    if (error instanceof DuplicateSubscriptionChargeError) return;
    throw error;
  }
}

export async function handleRecurringPaymentSuccess(
  event: NormalizedProviderWebhookEvent
) {
  const product = requireDealerProduct(event);
  assertRippleAmountMatchesProduct(product, event.amount);
  try {
    await runPaymentTransaction(async (client) => {
      const resolved = await resolveDealer(event, product, client);
      const existing = await findSubscription(resolved, client);
      const nextPeriodEnd = laterDate(
        existing?.currentPeriodEnd,
        addClampedCalendarMonth(event.eventTimestamp ?? new Date())
      );
      const result = await upsertSubscription(
        resolved,
        event,
        {
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          providerLifecycle: "ACTIVE",
          currentPeriodEnd: nextPeriodEnd,
        },
        client
      );
      if (
        result?.applied &&
        !(await recordCharge(result.subscription.id, event, client))
      ) {
        throw new DuplicateSubscriptionChargeError();
      }
    });
  } catch (error) {
    if (error instanceof DuplicateSubscriptionChargeError) return;
    throw error;
  }
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
  if (event.metadata.checkoutType !== "dealer_subscription") return null;
  const product = resolveRippleProduct({
    linkCode: event.linkCode,
    packageName: event.packageName,
  });
  if (product && product.checkoutType === "dealer_subscription") {
    const resolved = await resolveDealer(event, product);
    const existing = await findSubscription(resolved);
    if (!existing) return null;
    return db.subscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: true,
        ...(event.currentPeriodEnd
          ? { currentPeriodEnd: event.currentPeriodEnd }
          : {}),
      },
    });
  }

  if (event.providerSubscriptionId) {
    const existing = await db.subscription.findFirst({
      where: { providerSubscriptionId: event.providerSubscriptionId },
    });
    if (!existing) return null;
    return db.subscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: true,
        ...(event.currentPeriodEnd
          ? { currentPeriodEnd: event.currentPeriodEnd }
          : {}),
      },
    });
  }

  if (event.metadata.dealerId) {
    const existing = await db.subscription.findFirst({
      where: {
        dealerId: event.metadata.dealerId,
        source: "PAYMENT",
        status: { in: ["ACTIVE", "PAST_DUE", "INCOMPLETE"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!existing) return null;
    return db.subscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: true,
        ...(event.currentPeriodEnd
          ? { currentPeriodEnd: event.currentPeriodEnd }
          : {}),
      },
    });
  }

  return null;
}
