import { db } from "@/lib/db";
import type { TradeEnquiryStatus } from "@prisma/client";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { canReadTradeEnquiry, canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { canTransitionTradeEnquiry } from "@/lib/trade-exchange/lifecycle";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { notifyTradeEnquiry } from "@/lib/trade-exchange/notify";
import { tradeEnquirySchema } from "@/lib/trade-exchange/validation";

export async function sendTradeEnquiry(actor: TradeActor, values: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const parsed = tradeEnquirySchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the enquiry and try again." };
  const limited = await tradeRateLimit("enquiry", actor.userId, 30, 3_600_000);
  if (limited) return { error: limited };
  const listing = await db.tradeListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, dealerId: true, status: true, dealer: { select: { user: { select: { email: true } } } } },
  });
  if (!listing) return { error: "Not found." };
  const sellerEligible = await sellerIsEligible(listing.dealerId);
  if (!canViewTradeListing({ actor, listingDealerId: listing.dealerId, status: listing.status, sellerEligible })) {
    return { error: "Not found." };
  }
  if (listing.dealerId === actor.dealerId) return { error: "You cannot enquire on your own listing." };
  const existing = await db.tradeEnquiry.findUnique({
    where: { listingId_fromDealerId: { listingId: listing.id, fromDealerId: actor.dealerId } },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== "OPEN" && existing.status !== "ACCEPTED_IN_PRINCIPLE") {
    return { error: "This enquiry is closed." };
  }
  const enquiry = await db.$transaction(async (tx) => {
    const record = existing
      ? await tx.tradeEnquiry.update({
          where: { id: existing.id },
          data: { offerPence: parsed.data.offerPence ?? null },
        })
      : await tx.tradeEnquiry.create({
          data: {
            listingId: listing.id,
            fromDealerId: actor.dealerId,
            toDealerId: listing.dealerId,
            offerPence: parsed.data.offerPence ?? null,
          },
        });
    await tx.tradeMessage.create({
      data: { enquiryId: record.id, senderDealerId: actor.dealerId, body: parsed.data.body },
    });
    if (!existing) await tx.tradeMetricEvent.create({ data: { kind: "ENQUIRY_OPENED", dealerId: actor.dealerId } });
    return record;
  });
  await notifyTradeEnquiry(listing.dealer.user.email);
  return { ok: true as const, id: enquiry.id };
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
  if (enquiry.status !== "OPEN" && enquiry.status !== "ACCEPTED_IN_PRINCIPLE") return { error: "This enquiry is closed." };
  const limited = await tradeRateLimit("enquiry-reply", actor.userId, 60, 3_600_000);
  if (limited) return { error: limited };
  await db.tradeMessage.create({ data: { enquiryId, senderDealerId: actor.dealerId, body: trimmed } });
  const recipient = actor.dealerId === enquiry.toDealerId ? enquiry.fromDealer.user.email : enquiry.toDealer.user.email;
  await notifyTradeEnquiry(recipient);
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
  await db.tradeEnquiry.update({ where: { id: enquiry.id }, data: { status: to } });
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
