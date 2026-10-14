import { db } from "@/lib/db";
import { sellerIsEligible } from "@/lib/trade-exchange/access";
import { canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { tradeReportSchema } from "@/lib/trade-exchange/validation";

export async function reportTradeListing(actor: TradeActor, values: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const parsed = tradeReportSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the report and try again." };
  const limited = await tradeRateLimit("report", actor.userId, 10, 3_600_000);
  if (limited) return { error: limited };
  const listing = await db.tradeListing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, dealerId: true, status: true },
  });
  if (!listing || listing.dealerId === actor.dealerId) return { error: "Not found." };
  const sellerEligible = await sellerIsEligible(listing.dealerId);
  if (!canViewTradeListing({ actor, listingDealerId: listing.dealerId, status: listing.status, sellerEligible })) {
    return { error: "Not found." };
  }
  await db.$transaction(async (tx) => {
    await tx.tradeReport.create({
      data: {
        listingId: listing.id,
        reporterDealerId: actor.dealerId,
        reasonCode: parsed.data.reasonCode,
        details: parsed.data.details,
      },
    });
    if (listing.status === "LIVE" || listing.status === "RESERVED") {
      await tx.tradeListing.update({ where: { id: listing.id }, data: { status: "PENDING_REVIEW" } });
      await tx.tradeListingEvent.create({
        data: {
          listingId: listing.id,
          actorUserId: actor.userId,
          fromStatus: listing.status,
          toStatus: "PENDING_REVIEW",
          source: "USER",
        },
      });
    }
    await tx.tradeMetricEvent.create({ data: { kind: "REPORT_OPENED", dealerId: actor.dealerId } });
  });
  return { ok: true as const };
}

export async function resolveTradeReport(adminUserId: string, reportId: string, decision: "RESOLVED" | "REJECTED") {
  const report = await db.tradeReport.findUnique({ where: { id: reportId }, select: { id: true, status: true, listingId: true } });
  if (!report || report.status !== "OPEN") return { error: "Not found." };
  await db.$transaction(async (tx) => {
    await tx.tradeReport.update({
      where: { id: report.id },
      data: { status: decision, resolvedAt: new Date(), resolvedByUserId: adminUserId },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: adminUserId,
        action: `trade.report.${decision.toLowerCase()}`,
        entityType: "TradeReport",
        entityId: report.id,
        details: { listingId: report.listingId },
      },
    });
  });
  return { ok: true as const };
}
