import type {
  CancellationRequestStatus,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logAdminAction } from "@/lib/admin/audit";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { getPolicyFlags } from "@/lib/policy/flags";

type DbClient = Prisma.TransactionClient | typeof db;

export const OPEN_CANCELLATION_STATUSES = [
  "REQUESTED",
  "ACKNOWLEDGED",
  "RECONCILED",
] as const satisfies CancellationRequestStatus[];

export const CANCELLATION_TRANSITIONS: Record<
  CancellationRequestStatus,
  CancellationRequestStatus[]
> = {
  REQUESTED: ["ACKNOWLEDGED", "RECONCILED", "REJECTED"],
  ACKNOWLEDGED: ["RECONCILED", "REJECTED"],
  RECONCILED: ["COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
};

export class CancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancellationError";
  }
}

export function canTransitionCancellation(
  from: CancellationRequestStatus,
  to: CancellationRequestStatus,
) {
  return CANCELLATION_TRANSITIONS[from].includes(to);
}

export function isProviderCancelled(subscription: {
  status: SubscriptionStatus;
  providerLifecycle?: string | null;
}) {
  return (
    subscription.status === "CANCELLED" ||
    subscription.providerLifecycle === "CANCELLED"
  );
}

export function isPaidEntitlementExpired(
  subscription: { currentPeriodEnd: Date | null },
  now = new Date(),
) {
  return (
    !subscription.currentPeriodEnd ||
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  );
}

function initialStatusForSubscription(subscription: {
  status: SubscriptionStatus;
  providerLifecycle?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd: Date | null;
}) {
  if (
    isProviderCancelled(subscription) &&
    !isPaidEntitlementExpired(subscription)
  ) {
    return "RECONCILED" as const;
  }
  return "REQUESTED" as const;
}

async function writeEvent(
  client: DbClient,
  input: {
    requestId: string;
    fromStatus: CancellationRequestStatus | null;
    toStatus: CancellationRequestStatus;
    actorUserId?: string | null;
    source: string;
    metadata?: Record<string, unknown>;
  },
) {
  return client.dealerCancellationRequestEvent.create({
    data: {
      requestId: input.requestId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function createDealerCancellationRequest(input: {
  dealerId: string;
  requestedByUserId: string;
  now?: Date;
}) {
  if (!getPolicyFlags().enableCancellationRequests) {
    throw new CancellationError("Cancellation requests are not enabled.");
  }

  const now = input.now ?? new Date();
  const subscription = await db.subscription.findFirst({
    where: {
      dealerId: input.dealerId,
      source: "PAYMENT",
      status: { in: ["ACTIVE", "PAST_DUE", "CANCELLED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) {
    throw new CancellationError("No paid dealer subscription found.");
  }
  if (
    subscription.status !== "CANCELLED" &&
    subscription.status !== "PAST_DUE" &&
    !isPaidSubscriptionEntitled(subscription, now) &&
    !subscription.cancelAtPeriodEnd
  ) {
    throw new CancellationError("This subscription is not eligible to cancel.");
  }

  const existing = await db.dealerCancellationRequest.findFirst({
    where: {
      subscriptionId: subscription.id,
      status: { in: [...OPEN_CANCELLATION_STATUSES] },
    },
  });
  if (existing) return { request: existing, created: false as const };

  const status = initialStatusForSubscription(subscription);
  const periodEndAt = subscription.currentPeriodEnd ?? now;
  const idempotencyKey = `cancel:${subscription.id}:${periodEndAt.toISOString()}`;

  try {
    const request = await db.$transaction(async (tx) => {
      const created = await tx.dealerCancellationRequest.create({
        data: {
          dealerId: input.dealerId,
          subscriptionId: subscription.id,
          requestedByUserId: input.requestedByUserId,
          status,
          idempotencyKey,
          periodEndAt,
        },
      });
      await writeEvent(tx, {
        requestId: created.id,
        fromStatus: null,
        toStatus: status,
        actorUserId: input.requestedByUserId,
        source: "DEALER",
      });
      if (status === "RECONCILED") {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { cancelAtPeriodEnd: true },
        });
      }
      return created;
    });
    return { request, created: true as const };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "P2002") {
      const open = await db.dealerCancellationRequest.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: { in: [...OPEN_CANCELLATION_STATUSES] },
        },
      });
      if (open) return { request: open, created: false as const };
    }
    throw error;
  }
}

export async function transitionDealerCancellationRequest(input: {
  requestId: string;
  toStatus: CancellationRequestStatus;
  actorUserId?: string | null;
  source: "STAFF" | "WEBHOOK" | "CRON";
  notes?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const request = await tx.dealerCancellationRequest.findUnique({
      where: { id: input.requestId },
      include: { subscription: true },
    });
    if (!request) throw new CancellationError("Cancellation request not found.");
    if (!canTransitionCancellation(request.status, input.toStatus)) {
      throw new CancellationError(
        `Cannot move a ${request.status} request to ${input.toStatus}.`,
      );
    }

    if (input.toStatus === "RECONCILED" && !isProviderCancelled(request.subscription)) {
      throw new CancellationError(
        "Reconciliation requires the provider subscription to already be cancelled.",
      );
    }

    if (input.toStatus === "COMPLETED") {
      if (
        !isProviderCancelled(request.subscription) ||
        !isPaidEntitlementExpired(request.subscription, now)
      ) {
        throw new CancellationError(
          "Completion requires provider cancellation and an expired paid period.",
        );
      }
    }

    const updated = await tx.dealerCancellationRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: input.toStatus,
        notes: input.notes ?? request.notes,
        processedAt: now,
        processedByAdminId:
          input.source === "STAFF" ? input.actorUserId ?? null : request.processedByAdminId,
        lastError: null,
      },
    });
    if (updated.count !== 1) {
      throw new CancellationError("Cancellation request changed. Refresh and try again.");
    }
    if (input.toStatus === "ACKNOWLEDGED" || input.toStatus === "RECONCILED") {
      await tx.subscription.update({
        where: { id: request.subscriptionId },
        data: { cancelAtPeriodEnd: true },
      });
    }
    const current = await tx.dealerCancellationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    await writeEvent(tx, {
      requestId: request.id,
      fromStatus: request.status,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      source: input.source,
      metadata: input.notes ? { notes: input.notes } : undefined,
    });
    if (input.source === "STAFF" && input.actorUserId) {
      await logAdminAction(
        {
          adminId: input.actorUserId,
          action: `CANCELLATION_${input.toStatus}`,
          entityType: "DealerCancellationRequest",
          entityId: request.id,
          details: {
            fromStatus: request.status,
            toStatus: input.toStatus,
            subscriptionId: request.subscriptionId,
          },
        },
        tx,
      );
    }
    return { request: current, fromStatus: request.status };
  });
}

export async function reconcileCancellationForSubscription(
  subscriptionId: string,
  source: "WEBHOOK" | "CRON" = "WEBHOOK",
  now = new Date(),
) {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!subscription) return null;

  const open = await db.dealerCancellationRequest.findFirst({
    where: {
      subscriptionId,
      status: { in: [...OPEN_CANCELLATION_STATUSES] },
    },
  });
  if (!open) return null;

  if (
    isProviderCancelled(subscription) &&
    !isPaidEntitlementExpired(subscription, now) &&
    (open.status === "REQUESTED" || open.status === "ACKNOWLEDGED")
  ) {
    return transitionDealerCancellationRequest({
      requestId: open.id,
      toStatus: "RECONCILED",
      source,
      now,
    });
  }

  if (
    isProviderCancelled(subscription) &&
    isPaidEntitlementExpired(subscription, now)
  ) {
    if (open.status === "REQUESTED" || open.status === "ACKNOWLEDGED") {
      await transitionDealerCancellationRequest({
        requestId: open.id,
        toStatus: "RECONCILED",
        source,
        now,
      });
    }
    const current = await db.dealerCancellationRequest.findUnique({
      where: { id: open.id },
    });
    if (current?.status === "RECONCILED") {
      return transitionDealerCancellationRequest({
        requestId: open.id,
        toStatus: "COMPLETED",
        source,
        now,
      });
    }
  }

  return null;
}

export async function reconcileStaleCancellationRequests(now = new Date()) {
  const open = await db.dealerCancellationRequest.findMany({
    where: { status: { in: [...OPEN_CANCELLATION_STATUSES] } },
    select: { subscriptionId: true },
  });
  const seen = new Set<string>();
  let processed = 0;
  for (const row of open) {
    if (seen.has(row.subscriptionId)) continue;
    seen.add(row.subscriptionId);
    const result = await reconcileCancellationForSubscription(
      row.subscriptionId,
      "CRON",
      now,
    );
    if (result) processed += 1;
  }
  return { processed, open: open.length };
}
