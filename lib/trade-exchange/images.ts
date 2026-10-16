import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { canEditTradeListing, canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { TRADE_MAX_IMAGE_BYTES, TRADE_PHOTO_LIMIT } from "@/lib/trade-exchange/constants";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { deleteTradeFile, readTradeFile, storeTradeFile } from "@/lib/trade-exchange/storage";
import { detectImageType } from "@/lib/trade-exchange/validation";

class TradeWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeWorkflowError";
  }
}

async function lockTradeLive(tx: Prisma.TransactionClient, dealerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trade-live:${dealerId}`})::bigint)`;
}

function photoError(error: unknown, fallback: string) {
  return { error: error instanceof TradeWorkflowError ? error.message : fallback };
}

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
  let stored: { fileId: string; filePath: string; width?: number; height?: number; size?: number };
  try {
    stored = await storeTradeFile({
      bytes,
      contentType,
      kind: "listings",
      ownerId: listing.dealerId,
      objectId: `${listing.id}-${listing.images.length + 1}-${Date.now().toString(36)}`,
    });
  } catch {
    return { error: "The photo could not be saved." };
  }
  try {
    await db.$transaction(async (tx) => {
      const seed = await tx.tradeListing.findUnique({ where: { id: listingId }, select: { dealerId: true } });
      if (!seed || !canEditTradeListing(actor, seed.dealerId)) throw new TradeWorkflowError("Not found.");
      await lockTradeLive(tx, seed.dealerId);
      const fresh = await tx.tradeListing.findUnique({
        where: { id: listingId },
        select: { id: true, dealerId: true, status: true, images: { select: { id: true } } },
      });
      if (!fresh || !canEditTradeListing(actor, fresh.dealerId) || fresh.status === "REMOVED") {
        throw new TradeWorkflowError("Not found.");
      }
      if (fresh.images.length >= TRADE_PHOTO_LIMIT) {
        throw new TradeWorkflowError(`A trade listing can have ${TRADE_PHOTO_LIMIT} photos.`);
      }
      await tx.tradeListingImage.create({
        data: {
          listingId: fresh.id,
          fileId: stored.fileId,
          filePath: stored.filePath,
          sortOrder: fresh.images.length,
          width: stored.width || 0,
          height: stored.height || 0,
          bytes: stored.size || bytes.length,
          contentType,
        },
      });
    });
  } catch (error) {
    // A failed commit response does not prove the attachment was rolled back.
    await db.tradeListingImage.count({ where: { fileId: stored.fileId } }).then(async (references) => {
      if (references === 0) await deleteTradeFile(stored.fileId, stored.filePath);
    }).catch((cleanupError: unknown) => {
      console.error("Trade photo attach cleanup failed", { reason: cleanupError instanceof Error ? cleanupError.name : "unknown" });
    });
    return photoError(error, "The photo could not be saved.");
  }
  return { ok: true as const };
}

export async function removeTradePhoto(actor: TradeActor, imageId: string) {
  if (actor.kind !== "member" && actor.kind !== "admin") return { error: "Not found." };
  const image = await db.tradeListingImage.findUnique({
    where: { id: imageId },
    select: { id: true, fileId: true, filePath: true, listing: { select: { id: true, dealerId: true, status: true, images: { select: { id: true } } } } },
  });
  if (!image || !canEditTradeListing(actor, image.listing.dealerId)) return { error: "Not found." };
  try {
    await db.$transaction(async (tx) => {
      const seed = await tx.tradeListingImage.findUnique({
        where: { id: imageId },
        select: { listing: { select: { dealerId: true } } },
      });
      if (!seed || !canEditTradeListing(actor, seed.listing.dealerId)) throw new TradeWorkflowError("Not found.");
      await lockTradeLive(tx, seed.listing.dealerId);
      const fresh = await tx.tradeListingImage.findUnique({
        where: { id: imageId },
        select: { id: true, listing: { select: { dealerId: true, status: true, images: { select: { id: true } } } } },
      });
      if (!fresh || !canEditTradeListing(actor, fresh.listing.dealerId)) throw new TradeWorkflowError("Not found.");
      const live = fresh.listing.status === "LIVE" || fresh.listing.status === "RESERVED";
      if (live && fresh.listing.images.length <= 1) {
        throw new TradeWorkflowError("A published trade listing needs at least one photo.");
      }
      const removed = await tx.tradeListingImage.deleteMany({ where: { id: fresh.id } });
      if (removed.count !== 1) throw new TradeWorkflowError("Not found.");
    });
  } catch (error) {
    return photoError(error, "The photo could not be removed.");
  }
  await deleteTradeFile(image.fileId, image.filePath).catch((error: unknown) => {
    console.error("Trade photo removal failed", { reason: error instanceof Error ? error.name : "unknown" });
  });
  return { ok: true as const };
}

export async function readAuthorizedTradePhoto(actor: TradeActor, imageId: string) {
  if (actor.kind !== "member" && actor.kind !== "admin") return null;
  const image = await db.tradeListingImage.findUnique({
    where: { id: imageId },
    select: { filePath: true, contentType: true, listing: { select: { dealerId: true, status: true, expiresAt: true } } },
  });
  if (!image) return null;
  const sellerEligible = actor.kind === "admin" ? true : await sellerIsEligible(image.listing.dealerId);
  if (!canViewTradeListing({
    actor,
    listingDealerId: image.listing.dealerId,
    status: image.listing.status,
    sellerEligible,
    expiresAt: image.listing.expiresAt,
  })) return null;
  const file = await readTradeFile(image.filePath);
  if (!file) return null;
  return { bytes: file.bytes, contentType: image.contentType };
}
