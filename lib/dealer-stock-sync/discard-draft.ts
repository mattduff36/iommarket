import { Prisma } from "@prisma/client";
import { cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";

export class StockDraftDiscardError extends Error {}
const CHANGED = "This received draft changed or is no longer available. Refresh your listings.";

/** Called in a serializable transaction. Never deletes the live parent of a revision. */
export async function discardReceivedStockDraftInTransaction(tx: Prisma.TransactionClient, input: {
  receiptId: string; expectedLifecycleRevision: number; userId: string;
}) {
  const initial = await tx.stockReviewDraftReceipt.findUnique({ where: { id: input.receiptId } });
  if (!initial || initial.userId !== input.userId) throw new StockDraftDiscardError(CHANGED);
  // Matches stock transfer's dealer -> listing ordering; receipt is re-read after locks.
  await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${initial.dealerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${initial.listingId} FOR UPDATE`;
  if (initial.revisionId) await tx.$queryRaw`SELECT "id" FROM "ListingRevision" WHERE "id" = ${initial.revisionId} FOR UPDATE`;
  const receipt = await tx.stockReviewDraftReceipt.findUnique({ where: { id: input.receiptId } });
  const listing = await tx.listing.findUnique({ where: { id: initial.listingId }, select: {
    id: true, userId: true, dealerId: true, status: true, lifecycleRevision: true,
  } });
  if (!receipt || receipt.userId !== input.userId || receipt.listingId !== initial.listingId ||
      receipt.dealerId !== initial.dealerId || receipt.revisionId !== initial.revisionId ||
      !listing || listing.userId !== input.userId || listing.dealerId !== receipt.dealerId ||
      listing.lifecycleRevision !== input.expectedLifecycleRevision) throw new StockDraftDiscardError(CHANGED);
  const select = { provider: true, publicId: true, imageKitFileId: true, imageKitFilePath: true } as const;
  const images = receipt.revisionId
    ? await tx.listingRevisionImage.findMany({ where: { revisionId: receipt.revisionId }, select })
    : await tx.listingImage.findMany({ where: { listingId: listing.id }, select });
  if (receipt.revisionId) {
    const removed = await tx.listingRevision.deleteMany({ where: { id: receipt.revisionId, listingId: listing.id, status: "DRAFT" } });
    if (removed.count !== 1) throw new StockDraftDiscardError(CHANGED);
    const changed = await tx.listing.updateMany({ where: { id: listing.id, userId: input.userId, lifecycleRevision: input.expectedLifecycleRevision }, data: { lifecycleRevision: { increment: 1 } } });
    if (changed.count !== 1) throw new StockDraftDiscardError(CHANGED);
  } else {
    if (listing.status !== "DRAFT") throw new StockDraftDiscardError(CHANGED);
    const removed = await tx.listing.deleteMany({ where: { id: listing.id, userId: input.userId, status: "DRAFT", lifecycleRevision: input.expectedLifecycleRevision } });
    if (removed.count !== 1) throw new StockDraftDiscardError(CHANGED);
  }
  // Keep immutable provenance in the stock audit after receipt cascade deletion.
  await tx.dealerStockSyncAudit.create({ data: {
    actorId: input.userId, action: "dealer-discard-received-draft",
    before: { receiptId: receipt.id, reportId: receipt.reportId, listingId: receipt.listingId, revisionId: receipt.revisionId,
      source: receipt.source, blockers: receipt.blockers } as Prisma.InputJsonValue,
    after: { discarded: true, revisionOnly: Boolean(receipt.revisionId) },
  } });
  for (const image of images) {
    // Global references protect originals and any other listing sharing an owned asset.
    const [live, revisions] = await Promise.all([
      tx.listingImage.count({ where: { provider: image.provider, publicId: image.publicId } }),
      tx.listingRevisionImage.count({ where: { provider: image.provider, publicId: image.publicId } }),
    ]);
    if (live || revisions) continue;
    const cleanup = cleanupDeliveryForRemovedImage(image);
    if (cleanup) await tx.listingImageCleanupJob.create({ data: { ...cleanup, reason: "received-stock-draft-discarded" } });
  }
  return { listingId: listing.id, revisionOnly: Boolean(receipt.revisionId) };
}
