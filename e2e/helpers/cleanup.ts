import { db } from "../../lib/db";
import { assertE2ECleanupAllowed } from "../../lib/ops/safety";

export async function cleanupE2EListings(listingIds: string[]) {
  assertE2ECleanupAllowed();
  if (listingIds.length === 0) return;
  await db.report.deleteMany({ where: { listingId: { in: listingIds } } });
  await db.listingStatusEvent.deleteMany({
    where: { listingId: { in: listingIds } },
  });
  await db.listing.deleteMany({ where: { id: { in: listingIds } } });
}
