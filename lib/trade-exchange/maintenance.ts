import { db } from "@/lib/db";
import { listEligibleTradeDealerIds } from "@/lib/trade-exchange/access";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { listingMatchesSavedSearch } from "@/lib/trade-exchange/search";
import { notifyTradeExpiry, notifyTradeSavedSearch } from "@/lib/trade-exchange/notify";
import { tradeSearchSchema } from "@/lib/trade-exchange/validation";

export async function maintainTradeExchange(now = new Date()) {
  if (!isTradeExchangeEnabled()) return { expired: 0, alerts: 0 };
  const expired = await db.tradeListing.findMany({
    where: { status: { in: ["LIVE", "RESERVED"] }, expiresAt: { lte: now } },
    select: { id: true, dealerId: true, status: true, dealer: { select: { user: { select: { email: true } } } } },
  });
  const notifiedDealers = new Set<string>();
  for (const listing of expired) {
    await db.$transaction(async (tx) => {
      const current = await tx.tradeListing.updateMany({
        where: { id: listing.id, status: listing.status, expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      if (current.count !== 1) return;
      await tx.tradeListingEvent.create({
        data: { listingId: listing.id, fromStatus: listing.status, toStatus: "EXPIRED", source: "SYSTEM" },
      });
    });
    if (!notifiedDealers.has(listing.dealerId)) {
      notifiedDealers.add(listing.dealerId);
      await notifyTradeExpiry(listing.dealer.user.email);
    }
  }

  const dealerIds = await listEligibleTradeDealerIds(now);
  const searches = await db.tradeSavedSearch.findMany({
    where: { dealerId: { in: dealerIds } },
    select: { id: true, filters: true, lastNotifiedAt: true, dealer: { select: { user: { select: { email: true } } } } },
  });
  let alerts = 0;
  for (const search of searches) {
    const parsed = tradeSearchSchema.safeParse(search.filters);
    if (!parsed.success) continue;
    const since = search.lastNotifiedAt ?? new Date(0);
    const listings = await db.tradeListing.findMany({
      where: { status: "LIVE", dealerId: { in: dealerIds }, publishedAt: { gt: since } },
      select: {
        make: true,
        model: true,
        year: true,
        mileage: true,
        transmission: true,
        fuel: true,
        conditionSummary: true,
        priceType: true,
        pricePence: true,
        dealerId: true,
        publishedAt: true,
      },
    });
    const matches = listings.filter((listing) => listingMatchesSavedSearch(listing, parsed.data));
    await db.tradeSavedSearch.update({ where: { id: search.id }, data: { lastNotifiedAt: now } });
    if (matches.length === 0) continue;
    await notifyTradeSavedSearch(search.dealer.user.email, matches.length);
    alerts += 1;
  }
  return { expired: expired.length, alerts };
}

export async function tradeStockSummary(dealerId: string, now = new Date()) {
  const listings = await db.tradeListing.findMany({
    where: { dealerId },
    select: { status: true, expiresAt: true },
  });
  const soon = now.getTime() + 7 * 86_400_000;
  const enquiries = await db.tradeEnquiry.count({
    where: { toDealerId: dealerId, status: "OPEN" },
  });
  return {
    live: listings.filter((listing) => listing.status === "LIVE").length,
    drafts: listings.filter((listing) => listing.status === "DRAFT").length,
    stale: listings.filter((listing) => listing.status === "LIVE" && listing.expiresAt && listing.expiresAt.getTime() <= soon).length,
    enquiries,
  };
}

export async function tradeAdminMetrics() {
  const [pendingApplications, approvedDealers, liveListings, openEnquiries, openReports, sold] = await Promise.all([
    db.tradeMembership.count({ where: { status: "PENDING" } }),
    db.tradeMembership.count({ where: { status: "APPROVED" } }),
    db.tradeListing.count({ where: { status: "LIVE" } }),
    db.tradeEnquiry.count({ where: { status: "OPEN" } }),
    db.tradeReport.count({ where: { status: "OPEN" } }),
    db.tradeMetricEvent.count({ where: { kind: "LISTING_SOLD" } }),
  ]);
  return { pendingApplications, approvedDealers, liveListings, openEnquiries, openReports, sold };
}
