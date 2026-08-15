import type {
  ListingModerationReason,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import { isListingEffectivelyExpired } from "@/lib/listings/expiry";
import { ListingLifecycleError, createListingStatusEvent } from "@/lib/listings/status-events";
import { validateModerationReason } from "@/lib/listings/moderation-reasons";
import {
  applyRevisionImages,
  cleanupRejectedRevisionOnlyImages,
  cloneLiveImagesToRevision,
} from "@/lib/listings/revision-photos";
import type { ListingNotificationIntent } from "@/lib/listings/notification-intents";

type DbClient = Prisma.TransactionClient | typeof db;

const OPEN_REVISION_STATUSES = ["DRAFT", "PENDING"] as const;

export class ListingRevisionConflictError extends Error {
  constructor(message = "Listing revision changed. Refresh and try again.") {
    super(message);
    this.name = "ListingRevisionConflictError";
  }
}

async function casListingRevision(
  client: DbClient,
  listingId: string,
  expectedRevision: number,
) {
  const bumped = await client.listing.updateMany({
    where: { id: listingId, lifecycleRevision: expectedRevision },
    data: { lifecycleRevision: { increment: 1 } },
  });
  if (bumped.count !== 1) {
    throw new ListingRevisionConflictError();
  }
}

export async function getOpenRevision(listingId: string) {
  return db.listingRevision.findFirst({
    where: {
      listingId,
      status: { in: [...OPEN_REVISION_STATUSES] },
    },
    include: {
      images: { orderBy: { order: "asc" } },
      attributeValues: true,
    },
  });
}

export async function getOrCreateDraftRevision(input: {
  listingId: string;
  userId: string;
}) {
  const existing = await getOpenRevision(input.listingId);
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: input.listingId },
        include: {
          attributeValues: true,
        },
      });
      if (!listing) throw new ListingLifecycleError("Listing not found");
      if (listing.userId !== input.userId) {
        throw new ListingLifecycleError("Not authorized for this listing action.");
      }
      if (listing.status !== "LIVE") {
        throw new ListingLifecycleError("Revisions can only be created for live listings.");
      }
      if (isListingEffectivelyExpired(listing)) {
        throw new ListingLifecycleError("This listing has expired and cannot be edited.");
      }

      const concurrentExisting = await tx.listingRevision.findFirst({
        where: {
          listingId: input.listingId,
          status: { in: [...OPEN_REVISION_STATUSES] },
        },
        include: {
          images: { orderBy: { order: "asc" } },
          attributeValues: true,
        },
      });
      if (concurrentExisting) return concurrentExisting;

      // Claim the listing lifecycle before creating the draft. A concurrent
      // take-down/expiry either wins this CAS or observes and discards the
      // newly-created revision; it cannot leave an open revision off LIVE.
      await casListingRevision(tx, listing.id, listing.lifecycleRevision);

      const created = await tx.listingRevision.create({
        data: {
          listingId: listing.id,
          title: listing.title,
          description: listing.description,
          price: listing.price,
          categoryId: listing.categoryId,
          regionId: listing.regionId,
          trustDeclarationAccepted: listing.trustDeclarationAccepted,
          trustDeclarationAcceptedAt: listing.trustDeclarationAcceptedAt,
          status: "DRAFT",
          attributeValues: {
            create: listing.attributeValues.map((attribute) => ({
              attributeDefinitionId: attribute.attributeDefinitionId,
              value: attribute.value,
            })),
          },
        },
        include: {
          images: { orderBy: { order: "asc" } },
          attributeValues: true,
        },
      });
      await cloneLiveImagesToRevision(tx, listing.id, created.id);
      return tx.listingRevision.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          images: { orderBy: { order: "asc" } },
          attributeValues: true,
        },
      });
    });
  } catch (error) {
    const winner = await getOpenRevision(input.listingId);
    if (winner) return winner;
    throw error;
  }
}

export async function updateDraftRevision(input: {
  listingId: string;
  userId: string;
  expectedVersion: number;
  expectedListingRevision: number;
  data: {
    title?: string;
    description?: string;
    price?: number;
    categoryId?: string;
    regionId?: string;
    trustDeclarationAccepted?: boolean;
  };
  attributes?: Array<{ attributeDefinitionId: string; value: string }>;
}) {
  return db.$transaction(async (tx) => {
    const revision = await tx.listingRevision.findFirst({
      where: { listingId: input.listingId, status: { in: [...OPEN_REVISION_STATUSES] } },
    });
    if (!revision) throw new ListingLifecycleError("Revision not found");
    if (revision.status !== "DRAFT") {
      throw new ListingLifecycleError("This revision is awaiting review and cannot be edited.");
    }
    if (revision.version !== input.expectedVersion) {
      throw new ListingRevisionConflictError();
    }

    const listing = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: { userId: true, lifecycleRevision: true, trustDeclarationAcceptedAt: true },
    });
    if (!listing || listing.userId !== input.userId) {
      throw new ListingLifecycleError("Not authorized for this listing action.");
    }
    if (listing.lifecycleRevision !== input.expectedListingRevision) {
      throw new ListingRevisionConflictError();
    }

    const updated = await tx.listingRevision.updateMany({
      where: { id: revision.id, status: "DRAFT", version: input.expectedVersion },
      data: {
        ...input.data,
        ...(input.data.trustDeclarationAccepted !== undefined
          ? {
              trustDeclarationAcceptedAt: input.data.trustDeclarationAccepted
                ? revision.trustDeclarationAcceptedAt ?? new Date()
                : null,
            }
          : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ListingRevisionConflictError();

    if (input.attributes) {
      await tx.listingRevisionAttributeValue.deleteMany({ where: { revisionId: revision.id } });
      if (input.attributes.length > 0) {
        await tx.listingRevisionAttributeValue.createMany({
          data: input.attributes.map((attribute) => ({
            revisionId: revision.id,
            attributeDefinitionId: attribute.attributeDefinitionId,
            value: attribute.value,
          })),
        });
      }
    }

    await casListingRevision(tx, input.listingId, input.expectedListingRevision);

    return tx.listingRevision.findUniqueOrThrow({
      where: { id: revision.id },
      include: {
        images: { orderBy: { order: "asc" } },
        attributeValues: true,
      },
    });
  });
}

async function writeRevisionEvent(
  client: DbClient,
  input: {
    listingId: string;
    action: "SUBMIT_REVISION" | "APPROVE_REVISION" | "REJECT_REVISION";
    actorId: string;
    reasonCode?: ListingModerationReason;
    notes?: string;
  },
): Promise<ListingNotificationIntent> {
  const event = await createListingStatusEvent(
    {
      listingId: input.listingId,
      fromStatus: "LIVE",
      toStatus: "LIVE",
      changedByUserId: input.actorId,
      source: input.action === "SUBMIT_REVISION" ? "USER" : "ADMIN",
      action: input.action,
      reasonCode: input.reasonCode,
      notes: input.notes,
    },
    client,
  );
  return {
    eventId: event.id,
    listingId: input.listingId,
    action: input.action,
    fromStatus: "LIVE",
    toStatus: "LIVE",
    reasonCode: input.reasonCode ?? null,
  };
}

export async function submitRevision(input: {
  listingId: string;
  userId: string;
  expectedListingRevision: number;
  expectedVersion: number;
}) {
  const result = await db.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({
      where: { id: input.listingId },
      include: { images: { select: { id: true } } },
    });
    if (!listing) throw new ListingLifecycleError("Listing not found");
    if (listing.userId !== input.userId) {
      throw new ListingLifecycleError("Not authorized for this listing action.");
    }
    if (listing.status !== "LIVE" || isListingEffectivelyExpired(listing)) {
      throw new ListingLifecycleError("Only live listings can submit changes for review.");
    }
    if (listing.lifecycleRevision !== input.expectedListingRevision) {
      throw new ListingRevisionConflictError();
    }

    const revision = await tx.listingRevision.findFirst({
      where: { listingId: input.listingId, status: "DRAFT" },
      include: { images: { select: { id: true } } },
    });
    if (!revision) throw new ListingLifecycleError("No draft changes to submit.");
    if (revision.version !== input.expectedVersion) {
      throw new ListingRevisionConflictError();
    }
    if (revision.images.length < 2) {
      throw new ListingLifecycleError("At least 2 photos are required");
    }
    if (!revision.trustDeclarationAccepted) {
      throw new ListingLifecycleError(
        "Please confirm the vehicle is not stolen and has no outstanding finance before submitting.",
      );
    }

    const submitted = await tx.listingRevision.updateMany({
      where: { id: revision.id, status: "DRAFT", version: input.expectedVersion },
      data: {
        status: "PENDING",
        submittedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (submitted.count !== 1) throw new ListingRevisionConflictError();

    await casListingRevision(tx, listing.id, input.expectedListingRevision);
    const notification = await writeRevisionEvent(tx, {
      listingId: listing.id,
      action: "SUBMIT_REVISION",
      actorId: input.userId,
    });
    const updatedListing = await tx.listing.findUniqueOrThrow({ where: { id: listing.id } });
    return { listing: updatedListing, notification };
  });

  try {
    await dispatchListingNotifications([result.notification]);
  } catch {
    // Email is best-effort and must not fail a committed revision submit.
  }
  return result;
}

export async function approveRevision(input: {
  listingId: string;
  adminId: string;
  expectedListingRevision: number;
  expectedVersion: number;
}) {
  const result = await db.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: input.listingId } });
    if (!listing) throw new ListingLifecycleError("Listing not found");
    if (listing.status !== "LIVE" || isListingEffectivelyExpired(listing)) {
      throw new ListingLifecycleError("This listing is not effectively live.");
    }
    if (listing.lifecycleRevision !== input.expectedListingRevision) {
      throw new ListingRevisionConflictError();
    }

    const revision = await tx.listingRevision.findFirst({
      where: { listingId: input.listingId, status: "PENDING" },
    });
    if (!revision) throw new ListingLifecycleError("No pending revision to approve.");
    if (revision.version !== input.expectedVersion) {
      throw new ListingRevisionConflictError();
    }

    const applied = await tx.listing.updateMany({
      where: {
        id: listing.id,
        status: "LIVE",
        lifecycleRevision: input.expectedListingRevision,
      },
      data: {
        title: revision.title,
        description: revision.description,
        price: revision.price,
        categoryId: revision.categoryId,
        regionId: revision.regionId,
        trustDeclarationAccepted: revision.trustDeclarationAccepted,
        trustDeclarationAcceptedAt: revision.trustDeclarationAcceptedAt,
        lifecycleRevision: { increment: 1 },
      },
    });
    if (applied.count !== 1) throw new ListingRevisionConflictError();

    await tx.listingAttributeValue.deleteMany({ where: { listingId: listing.id } });
    const attributes = await tx.listingRevisionAttributeValue.findMany({
      where: { revisionId: revision.id },
    });
    if (attributes.length > 0) {
      await tx.listingAttributeValue.createMany({
        data: attributes.map((attribute) => ({
          listingId: listing.id,
          attributeDefinitionId: attribute.attributeDefinitionId,
          value: attribute.value,
        })),
      });
    }

    await applyRevisionImages(tx, listing.id, revision.id);

    const decided = await tx.listingRevision.updateMany({
      where: { id: revision.id, status: "PENDING", version: input.expectedVersion },
      data: {
        status: "APPROVED",
        decidedAt: new Date(),
        decidedByUserId: input.adminId,
        version: { increment: 1 },
      },
    });
    if (decided.count !== 1) throw new ListingRevisionConflictError();

    await tx.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: "LISTING_APPROVE_REVISION",
        entityType: "Listing",
        entityId: listing.id,
        details: { revisionId: revision.id },
      },
    });

    const notification = await writeRevisionEvent(tx, {
      listingId: listing.id,
      action: "APPROVE_REVISION",
      actorId: input.adminId,
    });
    return {
      listing: await tx.listing.findUniqueOrThrow({ where: { id: listing.id } }),
      notification,
    };
  });

  try {
    await dispatchListingNotifications([result.notification]);
  } catch {
    // Email is best-effort and must not fail a committed revision approval.
  }
  return result;
}

export async function rejectRevision(input: {
  listingId: string;
  adminId: string;
  expectedListingRevision: number;
  expectedVersion: number;
  reasonCode: ListingModerationReason;
  notes?: string;
}) {
  const reasonError = validateModerationReason({
    reasonCode: input.reasonCode,
    notes: input.notes,
    required: true,
  });
  if (reasonError) throw new ListingLifecycleError(reasonError);

  const result = await db.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: input.listingId } });
    if (!listing) throw new ListingLifecycleError("Listing not found");
    if (listing.lifecycleRevision !== input.expectedListingRevision) {
      throw new ListingRevisionConflictError();
    }

    const revision = await tx.listingRevision.findFirst({
      where: { listingId: input.listingId, status: "PENDING" },
    });
    if (!revision) throw new ListingLifecycleError("No pending revision to reject.");
    if (revision.version !== input.expectedVersion) {
      throw new ListingRevisionConflictError();
    }

    const rejected = await tx.listingRevision.updateMany({
      where: { id: revision.id, status: "PENDING", version: input.expectedVersion },
      data: {
        status: "REJECTED",
        reasonCode: input.reasonCode,
        notes: input.notes,
        decidedAt: new Date(),
        decidedByUserId: input.adminId,
        version: { increment: 1 },
      },
    });
    if (rejected.count !== 1) throw new ListingRevisionConflictError();

    await casListingRevision(tx, listing.id, input.expectedListingRevision);
    await cleanupRejectedRevisionOnlyImages(tx, listing.id, revision.id);

    await tx.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: "LISTING_REJECT_REVISION",
        entityType: "Listing",
        entityId: listing.id,
        details: { revisionId: revision.id, reasonCode: input.reasonCode },
      },
    });

    const notification = await writeRevisionEvent(tx, {
      listingId: listing.id,
      action: "REJECT_REVISION",
      actorId: input.adminId,
      reasonCode: input.reasonCode,
      notes: input.notes,
    });
    return {
      listing: await tx.listing.findUniqueOrThrow({ where: { id: listing.id } }),
      notification,
    };
  });

  try {
    await dispatchListingNotifications([result.notification]);
  } catch {
    // Email is best-effort and must not fail a committed revision rejection.
  }
  return result;
}
