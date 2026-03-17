import type {
  ListingStatus,
  ListingStatusEventSource,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";

interface TransitionListingStatusInput {
  listingId: string;
  toStatus: ListingStatus;
  changedByUserId?: string | null;
  source: ListingStatusEventSource;
  notes?: string;
  additionalData?: Prisma.ListingUpdateInput;
}

interface CreateListingStatusEventInput {
  listingId: string;
  fromStatus?: ListingStatus | null;
  toStatus: ListingStatus;
  changedByUserId?: string | null;
  source: ListingStatusEventSource;
  notes?: string;
}

function hasUpdateData(data: Prisma.ListingUpdateInput | undefined): boolean {
  return Boolean(data && Object.keys(data).length > 0);
}

export async function createListingStatusEvent(
  input: CreateListingStatusEventInput
) {
  return db.listingStatusEvent.create({
    data: {
      listingId: input.listingId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      changedByUserId: input.changedByUserId ?? null,
      source: input.source,
      notes: input.notes,
    },
  });
}

export async function transitionListingStatus(
  input: TransitionListingStatusInput
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new Error("Listing not found");
    }

    const statusChanged = existing.status !== input.toStatus;
    const shouldUpdate = statusChanged || hasUpdateData(input.additionalData);

    const updatedListing = shouldUpdate
      ? await tx.listing.update({
          where: { id: input.listingId },
          data: {
            ...(input.additionalData ?? {}),
            ...(statusChanged ? { status: input.toStatus } : {}),
          },
        })
      : await tx.listing.findUniqueOrThrow({ where: { id: input.listingId } });

    if (statusChanged) {
      await tx.listingStatusEvent.create({
        data: {
          listingId: input.listingId,
          fromStatus: existing.status,
          toStatus: input.toStatus,
          changedByUserId: input.changedByUserId ?? null,
          source: input.source,
          notes: input.notes,
        },
      });
    }

    return updatedListing;
  });
}
