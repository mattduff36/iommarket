import { db } from "@/lib/db";
import type { Prisma, TradeEnquiryStatus } from "@prisma/client";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { canReadTradeEnquiry, canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { canTransitionTradeEnquiry } from "@/lib/trade-exchange/lifecycle";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { notifyTradeEnquiry } from "@/lib/trade-exchange/notify";
import { tradeEnquirySchema } from "@/lib/trade-exchange/validation";

const OPEN_ENQUIRY_STATUSES = ["OPEN", "ACCEPTED_IN_PRINCIPLE"] as const;

function enquiryIsOpen(status: string) {
  return status === "OPEN" || status === "ACCEPTED_IN_PRINCIPLE";
}

class TradeWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeWorkflowError";
  }
}

function enquiryError(error: unknown, fallback: string) {
  return { error: error instanceof TradeWorkflowError ? error.message : fallback };
}

async function lockEnquiryPair(tx: Prisma.TransactionClient, listingId: string, fromDealerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trade-enquiry:${listingId}:${fromDealerId}`})::bigint)`;
}

export async function sendTradeEnquiry(actor: TradeActor, values: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const parsed = tradeEnquirySchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the enquiry and try again." };
  const limited = await tradeRateLimit("enquiry", actor.userId, 30, 3_600_000);
  if (limited) return { error: limited };
  const listing = await db.tradeListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, dealerId: true, status: true, expiresAt: true, dealer: { select: { user: { select: { email: true } } } } },
  });
  if (!listing) return { error: "Not found." };
  const sellerEligible = await sellerIsEligible(listing.dealerId);
  if (!canViewTradeListing({
    actor,
    listingDealerId: listing.dealerId,
    status: listing.status,
    sellerEligible,
    expiresAt: listing.expiresAt,
  })) {
    return { error: "Not found." };
  }
  if (listing.dealerId === actor.dealerId) return { error: "You cannot enquire on your own listing." };
  try {
    const enquiry = await db.$transaction(async (tx) => {
      await lockEnquiryPair(tx, parsed.data.listingId, actor.dealerId);
      const current = await tx.tradeListing.findUnique({
        where: { id: parsed.data.listingId },
        select: { id: true, dealerId: true, status: true, expiresAt: true, dealer: { select: { user: { select: { email: true } } } } },
      });
      if (!current) throw new TradeWorkflowError("Not found.");
      const currentSellerEligible = current.dealerId === listing.dealerId ? sellerEligible : await sellerIsEligible(current.dealerId);
      if (!canViewTradeListing({
        actor,
        listingDealerId: current.dealerId,
        status: current.status,
        sellerEligible: currentSellerEligible,
        expiresAt: current.expiresAt,
      })) {
        throw new TradeWorkflowError("Not found.");
      }
      if (current.dealerId === actor.dealerId) throw new TradeWorkflowError("You cannot enquire on your own listing.");
      const existing = await tx.tradeEnquiry.findUnique({
        where: { listingId_fromDealerId: { listingId: current.id, fromDealerId: actor.dealerId } },
        select: { id: true, status: true },
      });
      if (existing && !enquiryIsOpen(existing.status)) {
        throw new TradeWorkflowError("This enquiry is closed.");
      }
      let enquiryId: string;
      if (existing) {
        const updated = await tx.tradeEnquiry.updateMany({
          where: { id: existing.id, status: { in: [...OPEN_ENQUIRY_STATUSES] } },
          data: { offerPence: parsed.data.offerPence ?? null },
        });
        if (updated.count !== 1) throw new TradeWorkflowError("This enquiry is closed.");
        enquiryId = existing.id;
      } else {
        const created = await tx.tradeEnquiry.create({
          data: {
            listingId: current.id,
            fromDealerId: actor.dealerId,
            toDealerId: current.dealerId,
            offerPence: parsed.data.offerPence ?? null,
          },
        });
        enquiryId = created.id;
        await tx.tradeMetricEvent.create({ data: { kind: "ENQUIRY_OPENED", dealerId: actor.dealerId } });
      }
      await tx.tradeMessage.create({
        data: { enquiryId, senderDealerId: actor.dealerId, body: parsed.data.body },
      });
      return { id: enquiryId, email: current.dealer.user.email };
    });
    await notifyTradeEnquiry(enquiry.email);
    return { ok: true as const, id: enquiry.id };
  } catch (error) {
    return enquiryError(error, "The enquiry could not be sent.");
  }
}

export async function replyToTradeEnquiry(actor: TradeActor, enquiryId: string, body: string) {
  if (actor.kind !== "member") return { error: "Not found." };
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) return { error: "Enter a message." };
  const enquiry = await db.tradeEnquiry.findUnique({
    where: { id: enquiryId },
    select: {
      id: true,
      status: true,
      fromDealerId: true,
      toDealerId: true,
      fromDealer: { select: { user: { select: { email: true } } } },
      toDealer: { select: { user: { select: { email: true } } } },
    },
  });
  if (!enquiry || !canReadTradeEnquiry({ actor, fromDealerId: enquiry.fromDealerId, toDealerId: enquiry.toDealerId })) {
    return { error: "Not found." };
  }
  if (!enquiryIsOpen(enquiry.status)) {
    return { error: "This enquiry is closed." };
  }
  const limited = await tradeRateLimit("enquiry-reply", actor.userId, 60, 3_600_000);
  if (limited) return { error: limited };
  try {
    const recipient = await db.$transaction(async (tx) => {
      const seed = await tx.tradeEnquiry.findUnique({
        where: { id: enquiryId },
        select: { listingId: true, fromDealerId: true },
      });
      if (!seed) throw new TradeWorkflowError("Not found.");
      await lockEnquiryPair(tx, seed.listingId, seed.fromDealerId);
      const current = await tx.tradeEnquiry.findUnique({
        where: { id: enquiryId },
        select: { id: true, status: true, fromDealerId: true, toDealerId: true, fromDealer: { select: { user: { select: { email: true } } } }, toDealer: { select: { user: { select: { email: true } } } } },
      });
      if (!current || !canReadTradeEnquiry({ actor, fromDealerId: current.fromDealerId, toDealerId: current.toDealerId })) {
        throw new TradeWorkflowError("Not found.");
      }
      if (!enquiryIsOpen(current.status)) {
        throw new TradeWorkflowError("This enquiry is closed.");
      }
      await tx.tradeMessage.create({ data: { enquiryId, senderDealerId: actor.dealerId, body: trimmed } });
      const bumped = await tx.tradeEnquiry.updateMany({
        where: { id: current.id, status: { in: [...OPEN_ENQUIRY_STATUSES] } },
        data: { updatedAt: new Date() },
      });
      if (bumped.count !== 1) throw new TradeWorkflowError("This enquiry is closed.");
      return actor.dealerId === current.toDealerId ? current.fromDealer.user.email : current.toDealer.user.email;
    });
    await notifyTradeEnquiry(recipient);
  } catch (error) {
    return enquiryError(error, "The reply could not be sent.");
  }
  return { ok: true as const };
}

export async function changeTradeEnquiryStatus(actor: TradeActor, enquiryId: string, to: TradeEnquiryStatus) {
  if (actor.kind !== "member" && actor.kind !== "admin") return { error: "Not found." };
  const enquiry = await db.tradeEnquiry.findUnique({
    where: { id: enquiryId },
    select: { id: true, status: true, fromDealerId: true, toDealerId: true },
  });
  if (!enquiry || !canReadTradeEnquiry({ actor, fromDealerId: enquiry.fromDealerId, toDealerId: enquiry.toDealerId })) {
    return { error: "Not found." };
  }
  const role = actor.kind === "admin"
    ? "admin"
    : actor.dealerId === enquiry.fromDealerId
      ? "enquirer"
      : "listing-owner";
  if (!canTransitionTradeEnquiry(enquiry.status, to, role)) return { error: "Not found." };
  try {
    await db.$transaction(async (tx) => {
      const seed = await tx.tradeEnquiry.findUnique({
        where: { id: enquiryId },
        select: { listingId: true, fromDealerId: true },
      });
      if (!seed) throw new TradeWorkflowError("Not found.");
      await lockEnquiryPair(tx, seed.listingId, seed.fromDealerId);
      const current = await tx.tradeEnquiry.findUnique({
        where: { id: enquiryId },
        select: { id: true, status: true, fromDealerId: true, toDealerId: true },
      });
      if (!current || !canReadTradeEnquiry({ actor, fromDealerId: current.fromDealerId, toDealerId: current.toDealerId })) {
        throw new TradeWorkflowError("Not found.");
      }
      const currentRole = actor.kind === "admin"
        ? "admin"
        : actor.dealerId === current.fromDealerId
          ? "enquirer"
          : "listing-owner";
      if (!canTransitionTradeEnquiry(current.status, to, currentRole)) throw new TradeWorkflowError("Not found.");
      const updated = await tx.tradeEnquiry.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: to },
      });
      if (updated.count !== 1) throw new TradeWorkflowError("Not found.");
    });
  } catch (error) {
    return enquiryError(error, "The enquiry could not be updated.");
  }
  return { ok: true as const };
}

export async function listTradeEnquiries(actor: TradeActor) {
  if (actor.kind !== "member") return [];
  return db.tradeEnquiry.findMany({
    where: { OR: [{ fromDealerId: actor.dealerId }, { toDealerId: actor.dealerId }] },
    select: {
      id: true,
      status: true,
      offerPence: true,
      updatedAt: true,
      listing: { select: { id: true, make: true, model: true, year: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTradeEnquiry(actor: TradeActor, enquiryId: string) {
  if (actor.kind !== "member" && actor.kind !== "admin") return null;
  const enquiry = await db.tradeEnquiry.findUnique({
    where: { id: enquiryId },
    select: {
      id: true,
      status: true,
      offerPence: true,
      fromDealerId: true,
      toDealerId: true,
      listing: { select: { id: true, make: true, model: true, year: true, dealerId: true } },
      fromDealer: { select: { name: true } },
      toDealer: { select: { name: true } },
      messages: {
        select: { id: true, body: true, createdAt: true, senderDealerId: true, sender: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!enquiry || !canReadTradeEnquiry({ actor, fromDealerId: enquiry.fromDealerId, toDealerId: enquiry.toDealerId })) return null;
  return enquiry;
}
