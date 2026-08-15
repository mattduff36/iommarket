import type { ListingStatusEventSource, Prisma } from "@prisma/client";
import { transitionListingStatus } from "@/lib/listings/status-events";
import type { ListingNotificationIntent } from "@/lib/listings/notification-intents";
import type { LifecycleActorRole } from "@/lib/listings/lifecycle";

export async function applyAccountDisableToListings(input: {
  tx: Prisma.TransactionClient;
  userId: string;
  actor: { id: string; role: LifecycleActorRole };
  source: ListingStatusEventSource;
  notes: string;
}) {
  const listings = await input.tx.listing.findMany({
    where: {
      userId: input.userId,
      status: { in: ["PENDING", "APPROVED", "LIVE"] },
    },
    select: { id: true, status: true, lifecycleRevision: true },
  });

  const notifications: ListingNotificationIntent[] = [];
  for (const listing of listings) {
    const result = await transitionListingStatus(
      {
        listingId: listing.id,
        action:
          listing.status === "PENDING"
            ? "ACCOUNT_DISABLE_PENDING"
            : "ACCOUNT_DISABLE",
        expectedRevision: listing.lifecycleRevision,
        actor: input.actor,
        source: input.source,
        reasonCode: "ACCOUNT_DISABLED",
        notes: input.notes,
      },
      input.tx,
    );
    if (result.notification) {
      notifications.push(result.notification);
    }
  }

  return { count: listings.length, notifications };
}
