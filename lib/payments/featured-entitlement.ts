import type { Prisma } from "@prisma/client";
import { liveListingWhere } from "@/lib/listings/expiry";

/** Apply one paid Featured entitlement when its listing is live. Call inside a transaction. */
export async function applyPaidFeaturedEntitlement(
  listingId: string,
  client: Prisma.TransactionClient,
  now = new Date(),
): Promise<boolean> {
  const listing = await client.listing.findFirst({
    where: { id: listingId, ...liveListingWhere(now) },
    select: { id: true, featured: true },
  });
  // Do not consume a paid entitlement when another source already featured it.
  if (!listing || listing.featured) return false;

  const payment = await client.payment.findFirst({
    where: {
      listingId,
      status: "SUCCEEDED",
      refundedAt: null,
      featuredAppliedAt: null,
      paymentProvider: { in: ["RIPPLE", "DEV"] },
      OR: [
        { type: "FEATURED" },
        { type: "LISTING", includesFeatured: true },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!payment) return false;

  const claimed = await client.payment.updateMany({
    where: {
      id: payment.id,
      status: "SUCCEEDED",
      refundedAt: null,
      featuredAppliedAt: null,
    },
    data: { featuredAppliedAt: now },
  });
  if (claimed.count !== 1) return false;

  const updated = await client.listing.updateMany({
    where: { id: listingId, featured: false, ...liveListingWhere(now) },
    data: { featured: true },
  });
  if (updated.count !== 1) {
    // Throw so the transaction rolls back the entitlement claim as well.
    throw new Error("Listing changed before the paid Featured entitlement could be applied.");
  }
  return true;
}
