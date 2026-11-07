import { db } from "@/lib/db";

/** Admin uploads are bound to a recalled draft, never an admin-owned seller listing. */
export async function canUploadAdminStockPhoto(user: { id: string; role: string }, target: {
  listingId?: string | null; intentId?: string;
}) {
  if (user.role !== "ADMIN") return false;
  const intent = target.intentId ? await db.listingImageUploadIntent.findUnique({
    where: { id: target.intentId }, select: { userId: true, listingId: true },
  }) : null;
  if (target.intentId && intent?.userId !== user.id) return false;
  const listingId = target.intentId ? intent?.listingId : target.listingId;
  if (!listingId || !/^[A-Za-z0-9_-]{1,100}$/.test(listingId)) return false;
  return Boolean(await db.listing.findFirst({ where: {
    id: listingId, stockReviewHeld: true, status: { in: ["DRAFT", "REJECTED"] },
    dealerId: { not: null }, soldAt: null, previewPackId: null, retentionPurgedAt: null,
  }, select: { id: true } }));
}
