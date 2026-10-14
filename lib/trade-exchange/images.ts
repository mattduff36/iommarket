import { db } from "@/lib/db";
import { canEditTradeListing, canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { TRADE_MAX_IMAGE_BYTES, TRADE_PHOTO_LIMIT } from "@/lib/trade-exchange/constants";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { deleteTradeFile, readTradeFile, storeTradeFile } from "@/lib/trade-exchange/storage";
import { detectImageType } from "@/lib/trade-exchange/validation";

export async function addTradePhoto(actor: TradeActor, listingId: string, bytes: Buffer) {
  if (actor.kind !== "member" && actor.kind !== "admin") return { error: "Not found." };
  const listing = await db.tradeListing.findUnique({
    where: { id: listingId },
    select: { id: true, dealerId: true, status: true, images: { select: { id: true, sortOrder: true } } },
  });
  if (!listing || !canEditTradeListing(actor, listing.dealerId) || listing.status === "REMOVED") return { error: "Not found." };
  if (listing.images.length >= TRADE_PHOTO_LIMIT) return { error: `A trade listing can have ${TRADE_PHOTO_LIMIT} photos.` };
  const limited = await tradeRateLimit("photo", actor.userId, 40, 3_600_000);
  if (limited) return { error: limited };
  if (bytes.length === 0 || bytes.length > TRADE_MAX_IMAGE_BYTES) return { error: "Use a JPG, PNG, or WebP photo under 10 MB." };
  const contentType = detectImageType(bytes);
  if (!contentType) return { error: "Use a JPG, PNG, or WebP photo." };
  const stored = await storeTradeFile({
    bytes,
    contentType,
    kind: "listings",
    ownerId: listing.dealerId,
    objectId: `${listing.id}-${listing.images.length + 1}`,
  });
  await db.tradeListingImage.create({
    data: {
      listingId: listing.id,
      fileId: stored.fileId,
      filePath: stored.filePath,
      sortOrder: listing.images.length,
      width: stored.width || 0,
      height: stored.height || 0,
      bytes: stored.size || bytes.length,
      contentType,
    },
  });
  return { ok: true as const };
}

export async function removeTradePhoto(actor: TradeActor, imageId: string) {
  if (actor.kind !== "member" && actor.kind !== "admin") return { error: "Not found." };
  const image = await db.tradeListingImage.findUnique({
    where: { id: imageId },
    select: { id: true, fileId: true, filePath: true, listing: { select: { id: true, dealerId: true, status: true, images: { select: { id: true } } } } },
  });
  if (!image || !canEditTradeListing(actor, image.listing.dealerId)) return { error: "Not found." };
  const live = image.listing.status === "LIVE" || image.listing.status === "RESERVED";
  if (live && image.listing.images.length <= 1) return { error: "A published trade listing needs at least one photo." };
  await db.tradeListingImage.delete({ where: { id: image.id } });
  await deleteTradeFile(image.fileId, image.filePath).catch((error: unknown) => {
    console.error("Trade photo removal failed", { reason: error instanceof Error ? error.name : "unknown" });
  });
  return { ok: true as const };
}

export async function readAuthorizedTradePhoto(actor: TradeActor, imageId: string) {
  if (actor.kind !== "member" && actor.kind !== "admin") return null;
  const image = await db.tradeListingImage.findUnique({
    where: { id: imageId },
    select: { filePath: true, contentType: true, listing: { select: { dealerId: true, status: true } } },
  });
  if (!image) return null;
  const sellerEligible = actor.kind === "admin" ? true : await sellerIsEligible(image.listing.dealerId);
  if (!canViewTradeListing({
    actor,
    listingDealerId: image.listing.dealerId,
    status: image.listing.status,
    sellerEligible,
  })) return null;
  const file = await readTradeFile(image.filePath);
  if (!file) return null;
  return { bytes: file.bytes, contentType: image.contentType };
}
