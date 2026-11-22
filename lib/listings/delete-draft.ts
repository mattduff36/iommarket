import type { Prisma } from "@prisma/client";
import { cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";

export class DeleteDraftError extends Error {}

export async function deleteDraftInTransaction(tx: Prisma.TransactionClient, input: {
  listingId: string; userId: string; expectedRevision: number;
}) {
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${input.listingId} FOR UPDATE`;
  const listing = await tx.listing.findUnique({
    where: { id: input.listingId },
    include: { payments: { select: { id: true } }, paymentCheckoutAttempts: { select: { id: true } },
      freeListingClaim: { select: { id: true } }, stockDraftReceipts: { select: { id: true } },
      statusEvents: { where: { OR: [{ fromStatus: "LIVE" }, { toStatus: "LIVE" }] }, select: { id: true } },
      images: true },
  });
  if (!listing || listing.userId !== input.userId || listing.status !== "DRAFT" ||
      listing.ownerArchivedAt || listing.lifecycleRevision !== input.expectedRevision) {
    throw new DeleteDraftError("This draft changed. Refresh your listings before deleting it.");
  }
  if (listing.stockReviewHeld || listing.stockDraftReceipts.length) {
    throw new DeleteDraftError("Use Discard in the received stock draft workflow for this listing.");
  }
  if (listing.payments.length || listing.paymentCheckoutAttempts.length || listing.statusEvents.length || listing.freeListingClaim) {
    await tx.listing.update({ where: { id: listing.id }, data: {
      ownerArchivedAt: new Date(), status: "TAKEN_DOWN", lifecycleRevision: { increment: 1 },
    } });
    await tx.listingStatusEvent.create({ data: {
      listingId: listing.id, fromStatus: "DRAFT", toStatus: "TAKEN_DOWN",
      changedByUserId: input.userId, source: "USER", notes: "Owner deleted draft; history retained.",
    } });
    return;
  }
  await tx.listing.delete({ where: { id: listing.id } });
  for (const image of listing.images) {
    const [live, revisions] = await Promise.all([
      tx.listingImage.count({ where: { provider: image.provider, publicId: image.publicId } }),
      tx.listingRevisionImage.count({ where: { provider: image.provider, publicId: image.publicId } }),
    ]);
    if (live || revisions) continue;
    const cleanup = cleanupDeliveryForRemovedImage(image);
    if (cleanup) await tx.listingImageCleanupJob.create({ data: { ...cleanup, reason: "owner-deleted-draft" } });
  }
}
