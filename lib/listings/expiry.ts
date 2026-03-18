import type { ListingStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { transitionListingStatus } from "@/lib/listings/status-events";

export function liveListingWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    status: "LIVE",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export function liveOrSoldListingWhere(
  includeSold: boolean,
  now = new Date()
): Prisma.ListingWhereInput {
  if (includeSold) {
    return {
      OR: [liveListingWhere(now), { status: "SOLD" }],
    };
  }
  return liveListingWhere(now);
}

export function isListingEffectivelyExpired(input: {
  status: ListingStatus;
  expiresAt: Date | null;
}): boolean {
  return (
    input.status === "EXPIRED" ||
    (input.status === "LIVE" &&
      input.expiresAt !== null &&
      input.expiresAt.getTime() <= Date.now())
  );
}

let lastExpirySweepAt = 0;
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
const EXPIRY_SWEEP_BATCH_SIZE = 200;

export async function expireStaleLiveListings(): Promise<number> {
  const nowMs = Date.now();
  if (nowMs - lastExpirySweepAt < EXPIRY_SWEEP_INTERVAL_MS) {
    return 0;
  }
  lastExpirySweepAt = nowMs;

  const staleListings = await db.listing.findMany({
    where: {
      status: "LIVE",
      expiresAt: { lte: new Date(nowMs) },
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: EXPIRY_SWEEP_BATCH_SIZE,
  });

  let updated = 0;
  for (const listing of staleListings) {
    try {
      await transitionListingStatus({
        listingId: listing.id,
        toStatus: "EXPIRED",
        changedByUserId: null,
        source: "SYSTEM",
        notes: "Listing expired automatically after expiry date",
      });
      updated += 1;
    } catch {
      // Best effort sweep; do not fail request paths.
    }
  }

  return updated;
}
