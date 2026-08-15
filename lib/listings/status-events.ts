import type {
  ListingLifecycleAction,
  ListingModerationReason,
  ListingStatus,
  ListingStatusEventSource,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { calculateExpiryDate } from "@/lib/listing-status";
import {
  canReinstateLive,
  canTransitionAction,
  getActionTargetStatus,
  isActionAuthorized,
  LIFECYCLE_ACTIONS_REQUIRING_REASON,
  type LifecycleActorRole,
} from "@/lib/listings/lifecycle";
import { validateModerationReason } from "@/lib/listings/moderation-reasons";

type DbClient = Prisma.TransactionClient | typeof db;

export class ListingLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingLifecycleError";
  }
}

export interface TransitionListingStatusInput {
  listingId: string;
  action: ListingLifecycleAction;
  expectedRevision: number;
  actor: { id: string | null; role: LifecycleActorRole };
  source: ListingStatusEventSource;
  reasonCode?: ListingModerationReason;
  notes?: string;
  reportId?: string;
  now?: Date;
}

interface CreateListingStatusEventInput {
  listingId: string;
  fromStatus?: ListingStatus | null;
  toStatus: ListingStatus;
  changedByUserId?: string | null;
  source: ListingStatusEventSource;
  notes?: string;
  action?: ListingLifecycleAction;
  reasonCode?: ListingModerationReason;
  reportId?: string | null;
}

function effectsForAction(
  action: ListingLifecycleAction,
  now: Date,
): Prisma.ListingUpdateInput {
  switch (action) {
    case "APPROVE":
      return { expiresAt: calculateExpiryDate(now) };
    case "REJECT":
    case "TAKE_DOWN":
    case "ACCOUNT_DISABLE":
    case "ACCOUNT_DISABLE_PENDING":
    case "RETURN_TO_DRAFT":
      return { featured: false };
    case "MARK_SOLD":
      return { soldAt: now };
    case "RENEW":
      return { expiresAt: null };
    default:
      return {};
  }
}

export async function createListingStatusEvent(
  input: CreateListingStatusEventInput,
  client: DbClient = db,
) {
  return client.listingStatusEvent.create({
    data: {
      listingId: input.listingId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      changedByUserId: input.changedByUserId ?? null,
      source: input.source,
      notes: input.notes,
      action: input.action,
      reasonCode: input.reasonCode,
      reportId: input.reportId ?? null,
    },
  });
}

async function runTransition(
  client: DbClient,
  input: TransitionListingStatusInput,
) {
  const now = input.now ?? new Date();
  const existing = await client.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      status: true,
      userId: true,
      expiresAt: true,
      lifecycleRevision: true,
    },
  });

  if (!existing) {
    throw new ListingLifecycleError("Listing not found");
  }

  if (existing.lifecycleRevision !== input.expectedRevision) {
    throw new ListingLifecycleError(
      "Listing status changed. Refresh and try again.",
    );
  }

  if (!canTransitionAction(input.action, existing.status)) {
    throw new ListingLifecycleError(
      `Invalid transition: ${input.action} from ${existing.status}`,
    );
  }

  const isOwner = Boolean(input.actor.id && input.actor.id === existing.userId);
  if (
    !isActionAuthorized({
      action: input.action,
      actorRole: input.actor.role,
      source: input.source,
      isOwner,
    })
  ) {
    throw new ListingLifecycleError("Not authorized for this listing action.");
  }

  const reasonError = validateModerationReason({
    reasonCode: input.reasonCode,
    notes: input.notes,
    required: LIFECYCLE_ACTIONS_REQUIRING_REASON.has(input.action),
  });
  if (reasonError) {
    throw new ListingLifecycleError(reasonError);
  }

  if (input.reportId) {
    const report = await client.report.findUnique({
      where: { id: input.reportId },
      select: { listingId: true },
    });
    if (!report || report.listingId !== existing.id) {
      throw new ListingLifecycleError(
        "Report does not belong to this listing.",
      );
    }
  }

  if (input.action === "REINSTATE_LIVE") {
    const priorLive = await client.listingStatusEvent.findFirst({
      where: {
        listingId: existing.id,
        OR: [{ fromStatus: "LIVE" }, { toStatus: "LIVE" }],
      },
      select: { id: true },
    });
    if (
      !canReinstateLive({
        status: existing.status,
        expiresAt: existing.expiresAt,
        now,
        hasPriorLive: Boolean(priorLive),
      })
    ) {
      throw new ListingLifecycleError(
        "This listing cannot be reinstated live. Return it to draft instead.",
      );
    }
  }

  const toStatus = getActionTargetStatus(input.action);
  const effects = effectsForAction(input.action, now);
  const updated = await client.listing.updateMany({
    where: {
      id: existing.id,
      status: existing.status,
      lifecycleRevision: input.expectedRevision,
    },
    data: {
      ...effects,
      status: toStatus,
      lifecycleRevision: { increment: 1 },
    },
  });

  if (updated.count !== 1) {
    throw new ListingLifecycleError(
      "Listing status changed. Refresh and try again.",
    );
  }

  await createListingStatusEvent(
    {
      listingId: existing.id,
      fromStatus: existing.status,
      toStatus,
      changedByUserId: input.actor.id,
      source: input.source,
      notes: input.notes,
      action: input.action,
      reasonCode: input.reasonCode,
      reportId: input.reportId,
    },
    client,
  );

  if (input.actor.role === "ADMIN" && input.actor.id) {
    await client.adminAuditLog.create({
      data: {
        adminId: input.actor.id,
        action: `LISTING_${input.action}`,
        entityType: "Listing",
        entityId: existing.id,
        details: {
          fromStatus: existing.status,
          toStatus,
          reasonCode: input.reasonCode ?? null,
          reportId: input.reportId ?? null,
          revision: input.expectedRevision,
        },
      },
    });
  }

  return client.listing.findUniqueOrThrow({ where: { id: existing.id } });
}

export async function transitionListingStatus(
  input: TransitionListingStatusInput,
  client?: DbClient,
) {
  if (client) {
    return runTransition(client, input);
  }

  return db.$transaction((tx) => runTransition(tx, input));
}
