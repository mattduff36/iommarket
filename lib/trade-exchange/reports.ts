import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { tradeReportSchema } from "@/lib/trade-exchange/validation";

class TradeWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeWorkflowError";
  }
}

async function lockTradeLive(tx: Prisma.TransactionClient, dealerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trade-live:${dealerId}`})::bigint)`;
}

export async function reportTradeListing(actor: TradeActor, values: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const parsed = tradeReportSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the report and try again." };
  const limited = await tradeRateLimit("report", actor.userId, 10, 3_600_000);
  if (limited) return { error: limited };
  const listing = await db.tradeListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, dealerId: true, status: true, expiresAt: true },
  });
  if (!listing || listing.dealerId === actor.dealerId) return { error: "Not found." };
  const sellerEligible = await sellerIsEligible(listing.dealerId);
  if (!canViewTradeListing({ actor, listingDealerId: listing.dealerId, status: listing.status, sellerEligible, expiresAt: listing.expiresAt })) {
    return { error: "Not found." };
  }
  try {
    await db.$transaction(async (tx) => {
      await lockTradeLive(tx, listing.dealerId);
      const current = await tx.tradeListing.findUnique({
        where: { id: listing.id },
        select: { id: true, dealerId: true, status: true },
      });
      if (!current) throw new TradeWorkflowError("Not found.");
      await tx.tradeReport.create({
        data: {
          listingId: current.id,
          reporterDealerId: actor.dealerId,
          reasonCode: parsed.data.reasonCode,
          details: parsed.data.details,
        },
      });
      if (current.status === "LIVE" || current.status === "RESERVED") {
        const held = await tx.tradeListing.updateMany({
          where: { id: current.id, status: current.status },
          data: { status: "PENDING_REVIEW" },
        });
        if (held.count === 1) {
          await tx.tradeListingEvent.create({
            data: {
              listingId: current.id,
              actorUserId: actor.userId,
              fromStatus: current.status,
              toStatus: "PENDING_REVIEW",
              source: "USER",
            },
          });
        }
      }
      await tx.tradeMetricEvent.create({ data: { kind: "REPORT_OPENED", dealerId: actor.dealerId } });
    });
  } catch (error) {
    return { error: error instanceof TradeWorkflowError ? error.message : "The report could not be saved." };
  }
  return { ok: true as const };
}

export async function resolveTradeReport(adminUserId: string, reportId: string, decision: "RESOLVED" | "REJECTED") {
  const report = await db.tradeReport.findUnique({ where: { id: reportId }, select: { id: true, status: true, listingId: true } });
  if (!report || report.status !== "OPEN") return { error: "Not found." };
  const resolved = await db.$transaction(async (tx) => {
    const updated = await tx.tradeReport.updateMany({
      where: { id: report.id, status: "OPEN" },
      data: { status: decision, resolvedAt: new Date(), resolvedByUserId: adminUserId },
    });
    if (updated.count !== 1) return false;
    await tx.adminAuditLog.create({
      data: {
        adminId: adminUserId,
        action: `trade.report.${decision.toLowerCase()}`,
        entityType: "TradeReport",
        entityId: report.id,
        details: { listingId: report.listingId },
      },
    });
    return true;
  });
  if (!resolved) return { error: "Not found." };
  return { ok: true as const };
}

