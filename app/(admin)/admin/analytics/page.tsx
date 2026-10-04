export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";
import {
  applySampleListingVisibility,
  applySampleUserVisibility,
  getSampleVisibility,
  PLACEHOLDER_AUTH_PREFIX,
} from "@/lib/listings/sample-visibility";
import {
  applySampleFavouriteVisibility,
  applySampleListingViewVisibility,
  applySampleSavedSearchVisibility,
} from "@/lib/listings/sample-related-visibility";
import { Card, CardContent } from "@/components/ui/card";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AnalyticsPanel } from "@/components/admin/analytics/analytics-panel";
import { AnalyticsRangeControl } from "@/components/admin/analytics/analytics-range-control";
import { CityRankList } from "@/components/admin/analytics/city-rank-list";
import { CHART_LISTING_VIEWS, CHART_PAGEVIEWS, CHART_USERS } from "@/components/admin/analytics/chart-colors";
import { ListingRankTable } from "@/components/admin/analytics/listing-rank-table";
import { MetricSparkCard } from "@/components/admin/analytics/metric-spark-card";
import { RankBars } from "@/components/admin/analytics/rank-bars";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { VisitorMapLoader } from "@/components/admin/analytics/visitor-map-loader";
import { analyticsRange, loadBusinessFunnel } from "@/lib/analytics/business-funnel";
import { locateCities } from "@/lib/analytics/city-coordinates";
import { MARKETPLACE_EVENTS } from "@/lib/analytics/events";
import { loadGoogleAnalytics } from "@/lib/analytics/google-analytics";
import { londonDate } from "@/lib/analytics/london-date";
import { calendarDay, trendSeries } from "@/lib/analytics/trend-series";

export const metadata: Metadata = { title: "Analytics | Admin" };

function readableLabel(value: string) {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sellerName(listing: { dealer: { name: string } | null; user: { email: string } }) {
  return listing.dealer?.name ?? listing.user.email;
}

export default async function AdminAnalyticsPage(props: {
  searchParams?: Promise<{ range?: string }>;
}) {
  await expireStaleLiveListings();
  const params = props.searchParams ? await props.searchParams : {};
  const range = analyticsRange(params.range);
  const now = new Date();
  const sampleVisibility = await getSampleVisibility();
  const liveWhere = applySampleListingVisibility(
    liveListingWhere(now),
    sampleVisibility,
  );
  const recentViewConditions = [
    Prisma.sql`views."createdAt" >= ${range.since}`,
  ];
  const placeholderAuthPattern = `${PLACEHOLDER_AUTH_PREFIX}%`;
  if (!sampleVisibility.privateListings) {
    recentViewConditions.push(
      Prisma.sql`NOT (
        listing."dealerId" IS NULL
        AND owner."authUserId" LIKE ${placeholderAuthPattern}
      )`,
      Prisma.sql`(
        views."viewerId" IS NULL
        OR NOT (
          viewer."authUserId" LIKE ${placeholderAuthPattern}
          AND viewer_dealer."id" IS NULL
        )
      )`,
    );
  }
  if (!sampleVisibility.dealerListings) {
    recentViewConditions.push(
      Prisma.sql`NOT (
        listing."dealerId" IS NOT NULL
        AND dealer."isAdminPreview" = FALSE
        AND owner."authUserId" LIKE ${placeholderAuthPattern}
      )`,
      Prisma.sql`(
        views."viewerId" IS NULL
        OR NOT (
          viewer."authUserId" LIKE ${placeholderAuthPattern}
          AND viewer_dealer."id" IS NOT NULL
          AND viewer_dealer."isAdminPreview" = FALSE
        )
      )`,
    );
  }
  const visibleLiveFavouriteWhere = applySampleFavouriteVisibility(
    { listing: liveWhere },
    sampleVisibility,
  );

  const [
    previousListingViews,
    totalUsers,
    totalListingsLive,
    totalFavourites,
    totalSavedSearches,
    topByViews,
    topFavouriteGroups,
    recentViews,
    dealerListingCount,
    privateListingCount,
  ] = await Promise.all([
    db.listingView.count({
      where: applySampleListingViewVisibility(
        { createdAt: { gte: range.previousSince, lt: range.since } },
        sampleVisibility,
      ),
    }),
    db.user.count({ where: applySampleUserVisibility({}, sampleVisibility) }),
    db.listing.count({ where: liveWhere }),
    db.favourite.count({
      where: applySampleFavouriteVisibility({}, sampleVisibility),
    }),
    db.savedSearch.count({
      where: applySampleSavedSearchVisibility({}, sampleVisibility),
    }),
    db.listing.findMany({
      where: liveWhere,
      orderBy: { viewCount: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        viewCount: true,
        dealer: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
    db.favourite.groupBy({
      by: ["listingId"],
      where: visibleLiveFavouriteWhere,
      _count: { _all: true },
      orderBy: { _count: { listingId: "desc" } },
      take: 10,
    }),
    db.$queryRaw<Array<{ day: string; count: bigint }>>(Prisma.sql`
      SELECT DATE(views."createdAt") AS day, COUNT(*)::bigint AS count
      FROM "ListingView" AS views
      JOIN "Listing" AS listing ON listing."id" = views."listingId"
      JOIN "User" AS owner ON owner."id" = listing."userId"
      LEFT JOIN "DealerProfile" AS dealer ON dealer."id" = listing."dealerId"
      LEFT JOIN "User" AS viewer ON viewer."id" = views."viewerId"
      LEFT JOIN "DealerProfile" AS viewer_dealer ON viewer_dealer."userId" = viewer."id"
      WHERE ${Prisma.join(recentViewConditions, " AND ")}
      GROUP BY DATE(views."createdAt")
      ORDER BY day ASC
    `),
    db.listing.count({ where: { ...liveWhere, dealerId: { not: null } } }),
    db.listing.count({ where: { ...liveWhere, dealerId: null } }),
  ]);
  const favouriteListingIds = topFavouriteGroups.map((row) => row.listingId);
  const favouriteListings = favouriteListingIds.length > 0
    ? await db.listing.findMany({
        where: { id: { in: favouriteListingIds } },
        select: {
          id: true,
          title: true,
          dealer: { select: { name: true } },
          user: { select: { email: true } },
        },
      })
    : [];
  const favouriteListingsById = new Map(
    favouriteListings.map((listing) => [listing.id, listing]),
  );
  const [funnel, acquisition] = await Promise.all([
    loadBusinessFunnel({
      since: range.since,
      sampleVisibility,
      liveWhere,
    }),
    loadGoogleAnalytics({ since: range.since, until: now }),
  ]);
  const visitorsAvailable = acquisition.status === "available";
  const trend = trendSeries({
    startDate: londonDate(range.since),
    endDate: londonDate(now),
    visitors: visitorsAvailable ? acquisition.series : [],
    listingViews: recentViews.flatMap((day) => {
      const date = calendarDay(day.day);
      return date ? [{ date, count: Number(day.count) }] : [];
    }),
  });
  const activity = [
    ["Listing views", funnel.views],
    ["Accounts created", funnel.signups],
    ["Listings submitted", funnel.listingsSubmitted],
    ["Checkouts started", funnel.checkoutStarted],
    ["Checkouts completed", funnel.checkoutCompleted],
    ["Live listings created", funnel.listingsLive],
    ["Favourites", funnel.favourites],
    ["Saved searches", funnel.savedSearches],
    ["Dealer subscriptions", funnel.dealerSubscriptions],
  ].map(([name, count]) => ({ name: String(name), count: Number(count) }));
  const locatedCities = visitorsAvailable ? locateCities(acquisition.cities) : [];
  const mapPoints = locatedCities.flatMap((city) => (
    city.mapped
      ? [{ city: city.city, country: city.country, count: city.count, latitude: city.latitude, longitude: city.longitude }]
      : []
  ));
  const sellerTotal = dealerListingCount + privateListingCount;
  const dealerShare = sellerTotal > 0 ? (dealerListingCount / sellerTotal) * 100 : 0;
  const topByFavourites = topFavouriteGroups.flatMap((group) => {
    const listing = favouriteListingsById.get(group.listingId);
    return listing ? [{ ...listing, favourites: group._count._all }] : [];
  });

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="Track marketplace engagement, audience growth, and the listings attracting attention."
        meta={<span>Database totals are authoritative. Visitor analytics include only consented browsers.</span>}
        actions={<AnalyticsRangeControl current={range.key} />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visitorsAvailable ? (
          <MetricSparkCard
            label="Users"
            value={acquisition.users.toLocaleString("en-GB")}
            current={acquisition.users}
            previous={acquisition.previousUsers}
            series={trend.map((point) => point.users)}
            color={CHART_USERS}
          />
        ) : null}
        {visitorsAvailable ? (
          <MetricSparkCard
            label="Pageviews"
            value={acquisition.pageviews.toLocaleString("en-GB")}
            current={acquisition.pageviews}
            previous={acquisition.previousPageviews}
            series={trend.map((point) => point.pageviews)}
            color={CHART_PAGEVIEWS}
          />
        ) : null}
        <MetricSparkCard
          label="Listing views"
          value={funnel.views.toLocaleString("en-GB")}
          current={funnel.views}
          previous={previousListingViews}
          series={trend.map((point) => point.listingViews)}
          color={CHART_LISTING_VIEWS}
        />
      </div>

      <AnalyticsPanel id="daily-trend-heading" title="Daily trend" detail={range.key} className="mb-6">
        <TrendChart points={trend} includeVisitors={visitorsAvailable} />
      </AnalyticsPanel>

      {visitorsAvailable ? (
        <div className="mb-6 space-y-6">
          <div className="grid gap-3 lg:grid-cols-2">
            <AnalyticsPanel id="channels-heading" title="Traffic source">
              <RankBars
                items={acquisition.channels}
                emptyLabel="No traffic source breakdown in this range."
              />
            </AnalyticsPanel>
            <AnalyticsPanel id="devices-heading" title="Devices">
              <RankBars
                items={acquisition.devices.map((device) => ({ name: readableLabel(device.name), count: device.count }))}
                color={CHART_PAGEVIEWS}
                emptyLabel="No device breakdown in this range."
              />
            </AnalyticsPanel>
          </div>

          <section className="grid gap-3 lg:grid-cols-5" aria-labelledby="locations-heading">
            <div className="flex h-full min-h-0 flex-col lg:col-span-3">
              <h2 id="locations-heading" className="mb-3 shrink-0 text-sm font-semibold text-text-primary">
                Visitor locations
                <span className="ml-2 font-normal text-text-tertiary">Consented users</span>
              </h2>
              {mapPoints.length > 0 ? (
                <>
                  <VisitorMapLoader points={mapPoints} />
                  <p className="mt-2 shrink-0 text-xs text-text-tertiary">Dot size shows consented users in each city.</p>
                </>
              ) : (
                <AdminEmptyState
                  compact
                  title="No cities could be placed on the map"
                  description="Country totals are listed beside this note. A city is plotted only when its name matches the local location list."
                />
              )}
            </div>
            <div className="space-y-4 lg:col-span-2">
              <AnalyticsPanel id="countries-heading" title="Countries">
                <RankBars items={acquisition.countries} emptyLabel="No country breakdown in this range." />
              </AnalyticsPanel>
              <AnalyticsPanel id="cities-heading" title="Cities">
                <CityRankList cities={locatedCities} />
              </AnalyticsPanel>
            </div>
          </section>

          <AnalyticsPanel id="events-heading" title="Custom events">
            <RankBars
              items={MARKETPLACE_EVENTS.map((eventName) => ({
                name: readableLabel(eventName),
                count: acquisition.events.find((event) => event.name === eventName)?.count ?? 0,
              }))}
              color={CHART_LISTING_VIEWS}
              emptyLabel="No custom events in this range."
            />
          </AnalyticsPanel>
        </div>
      ) : (
        <div className="mb-6">
          <AdminEmptyState
            compact
            title={acquisition.status === "not-configured"
              ? "Google Analytics reporting is not configured"
              : acquisition.status === "no-data"
                ? "No Google Analytics data in this range"
                : "Google Analytics reporting is temporarily unavailable"}
            description={acquisition.status === "not-configured"
              ? "Configure GA4_PROPERTY_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in the server environment."
              : acquisition.status === "no-data"
                ? "Consented visitor reports will appear here after Google Analytics records activity in this date range."
                : "Google Analytics could not return this report. The dashboard will continue to show marketplace database totals."}
          />
        </div>
      )}

      <AnalyticsPanel id="activity-heading" title="Activity" detail={range.key} className="mb-6">
        <p className="mb-3 text-xs text-text-tertiary">
          These are activity totals for the selected range, not one visitor cohort. Search and contact interactions appear as consented Google Analytics events because those actions are not stored as marketplace records.
        </p>
        <RankBars items={activity} emptyLabel="No marketplace activity in this range." />
      </AnalyticsPanel>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricSparkCard label="Registered users" value={totalUsers.toLocaleString("en-GB")} />
        <MetricSparkCard label="Live listings" value={totalListingsLive.toLocaleString("en-GB")} />
        <MetricSparkCard label="Total favourites" value={totalFavourites.toLocaleString("en-GB")} />
        <MetricSparkCard label="Saved searches" value={totalSavedSearches.toLocaleString("en-GB")} />
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium text-text-secondary">Live seller mix</p>
            <p className="mt-2 text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">
              {dealerListingCount.toLocaleString("en-GB")} / {privateListingCount.toLocaleString("en-GB")}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">Dealer / private</p>
            {sellerTotal > 0 ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-premium-gold-500" aria-hidden="true">
                <div className="h-full bg-neon-blue-500" style={{ width: `${dealerShare}%` }} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="top-views-heading">
        <h2 id="top-views-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Top listings by views
        </h2>
        <ListingRankTable
          label="Views"
          empty="No live listings have view data yet."
          barClassName="bg-neon-blue-500"
          rows={topByViews.map((listing) => ({
            id: listing.id,
            title: listing.title,
            seller: sellerName(listing),
            value: listing.viewCount,
          }))}
        />
      </section>

      <section className="mt-8" aria-labelledby="top-favourites-heading">
        <h2 id="top-favourites-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Top listings by favourites
        </h2>
        <ListingRankTable
          label="Favourites"
          empty="No live listings have favourites yet."
          barClassName="bg-premium-gold-500"
          rows={topByFavourites.map((listing) => ({
            id: listing.id,
            title: listing.title,
            seller: sellerName(listing),
            value: listing.favourites,
          }))}
        />
      </section>
    </>
  );
}
