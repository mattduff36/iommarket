export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { analyticsRange, loadBusinessFunnel } from "@/lib/analytics/business-funnel";
import { MARKETPLACE_EVENTS } from "@/lib/analytics/events";
import { loadVercelAcquisition } from "@/lib/analytics/vercel-web-analytics";

export const metadata: Metadata = { title: "Analytics | Admin" };

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">
          {value}
        </p>
        {detail ? (
          <p className="mt-1 text-xs text-text-tertiary">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminAnalyticsPage(
  props: { searchParams?: Promise<{ range?: string }> } = {},
) {
  await expireStaleLiveListings();
  const params = props.searchParams ? await props.searchParams : {};
  const range = analyticsRange(params.range);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sampleVisibility = await getSampleVisibility();
  const liveWhere = applySampleListingVisibility(
    liveListingWhere(now),
    sampleVisibility,
  );
  const recentViewConditions = [
    Prisma.sql`views."createdAt" >= ${sevenDaysAgo}`,
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
    totalViews30d,
    totalViews7d,
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
        { createdAt: { gte: thirtyDaysAgo } },
        sampleVisibility,
      ),
    }),
    db.listingView.count({
      where: applySampleListingViewVisibility(
        { createdAt: { gte: sevenDaysAgo } },
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
      ORDER BY day DESC
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
    loadVercelAcquisition({ since: range.since, until: now }),
  ]);
  const funnelSteps = [
    ["Listing views", funnel.views],
    ["Accounts created", funnel.signups],
    ["Listings submitted", funnel.listingsSubmitted],
    ["Checkouts started", funnel.checkoutStarted],
    ["Checkouts completed", funnel.checkoutCompleted],
    ["Live listings created", funnel.listingsLive],
    ["Favourites", funnel.favourites],
    ["Saved searches", funnel.savedSearches],
    ["Dealer subscriptions", funnel.dealerSubscriptions],
  ] as const;
  const topByFavourites = topFavouriteGroups.flatMap((group) => {
    const listing = favouriteListingsById.get(group.listingId);
    return listing
      ? [{ ...listing, _count: { favouritedBy: group._count._all } }]
      : [];
  });

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="Track marketplace engagement, audience growth, and the listings attracting attention."
        meta={<span>Database totals are authoritative. Visitor analytics include only consented browsers.</span>}
      />

      <section className="mb-8" aria-labelledby="funnel-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="funnel-heading" className="text-sm font-semibold text-text-primary">
            Activity and conversion
            <span className="ml-2 font-normal text-text-tertiary">{range.key}</span>
          </h2>
          <div className="flex gap-2 text-sm">
            {(["7d", "30d", "90d"] as const).map((option) => (
              <a
                key={option}
                href={`/admin/analytics?range=${option}`}
                aria-current={range.key === option ? "page" : undefined}
                className={range.key === option ? "font-semibold text-text-primary" : "text-text-secondary"}
              >
                {option}
              </a>
            ))}
          </div>
        </div>
        <p className="mb-3 text-xs text-text-tertiary">
          These are activity totals for the selected range, not one visitor cohort. Search and contact steps are consented Vercel events because those actions are not stored as marketplace records.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {funnelSteps.map(([label, value], index) => {
            const previous = index > 0 ? funnelSteps[index - 1]?.[1] : undefined;
            const rate = previous && previous > 0 ? Math.round((value / previous) * 100) : null;
            return (
              <MetricCard
                key={label}
                label={label}
                value={value.toLocaleString()}
                detail={rate === null ? undefined : `${rate}% of previous step`}
              />
            );
          })}
        </div>
      </section>

      <section className="mb-8" aria-labelledby="acquisition-heading">
        <h2 id="acquisition-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Consented visitor analytics
        </h2>
        {acquisition.available ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard label="Visitors" value={(acquisition.visitors ?? 0).toLocaleString()} />
              <MetricCard label="Pageviews" value={(acquisition.pageviews ?? 0).toLocaleString()} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold text-text-secondary">Custom events</h3>
                <ul className="space-y-1 text-sm text-text-primary">
                  {MARKETPLACE_EVENTS.map((eventName) => {
                    const match = acquisition.events.find((event) => event.name === eventName);
                    return <li key={eventName}>{eventName}: {(match?.count ?? 0).toLocaleString()}</li>;
                  })}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold text-text-secondary">Devices</h3>
                {acquisition.devices.length > 0 ? (
                  <ul className="space-y-1 text-sm text-text-primary">
                    {acquisition.devices.map((device) => (
                      <li key={device.name}>{device.name}: {device.count.toLocaleString()}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-tertiary">No device breakdown in this range.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <AdminEmptyState
            compact
            title="Vercel acquisition data is unavailable"
            description="Pageviews still collect after consent. Server reporting needs VERCEL_ACCESS_TOKEN, VERCEL_PROJECT_ID, and VERCEL_ORG_ID."
          />
        )}
      </section>

      {/* Overview cards */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Views (30d)" value={totalViews30d.toLocaleString()} />
        <MetricCard label="Views (7d)" value={totalViews7d.toLocaleString()} />
        <MetricCard label="Users" value={totalUsers.toLocaleString()} />
        <MetricCard label="Live listings" value={totalListingsLive.toLocaleString()} />
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total favourites" value={totalFavourites.toLocaleString()} />
        <MetricCard label="Saved searches" value={totalSavedSearches.toLocaleString()} />
        <MetricCard
          label="Live seller mix"
          value={`${dealerListingCount} / ${privateListingCount}`}
          detail="Dealer / private"
        />
      </div>

      {/* Daily views */}
      <section className="mb-8" aria-labelledby="daily-views-heading">
        <h2 id="daily-views-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Daily views
          <span className="ml-2 font-normal text-text-tertiary">Last 7 days</span>
        </h2>
        {recentViews.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {recentViews.map((day) => {
              const date = new Date(day.day);
              return (
                <div key={day.day} className="rounded-lg border border-border bg-surface px-3 py-3 text-center shadow-low">
                  <p className="text-xs text-text-tertiary">
                    {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">
                    {Number(day.count).toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <AdminEmptyState
            compact
            title="No view data yet"
            description="Daily activity will appear after listings receive views."
          />
        )}
      </section>

      {/* Top by views */}
      <section aria-labelledby="top-views-heading">
        <h2 id="top-views-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Top listings by views
        </h2>
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead>Views</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topByViews.map((listing, i) => (
              <TableRow key={listing.id}>
                <TableCell className="w-12 text-xs tabular-nums text-text-tertiary">{i + 1}</TableCell>
                <TableCell>
                  <AdminDataCell title={listing.title} />
                </TableCell>
                <TableCell className="text-text-secondary">{listing.dealer?.name ?? listing.user.email}</TableCell>
                <TableCell className={adminNumericCellClass}>
                  {listing.viewCount.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {topByViews.length === 0 ? (
              <TableRow>
                <AdminTableEmpty colSpan={4}>No live listings have view data yet.</AdminTableEmpty>
              </TableRow>
            ) : null}
          </TableBody>
        </AdminTable>
      </section>

      {/* Top by favourites */}
      <section className="mt-8" aria-labelledby="top-favourites-heading">
        <h2 id="top-favourites-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Top listings by favourites
        </h2>
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead>Favourites</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topByFavourites.map((listing, i) => (
              <TableRow key={listing.id}>
                <TableCell className="w-12 text-xs tabular-nums text-text-tertiary">{i + 1}</TableCell>
                <TableCell>
                  <AdminDataCell title={listing.title} />
                </TableCell>
                <TableCell className="text-text-secondary">{listing.dealer?.name ?? listing.user.email}</TableCell>
                <TableCell className={adminNumericCellClass}>
                  {listing._count.favouritedBy}
                </TableCell>
              </TableRow>
            ))}
            {topByFavourites.length === 0 ? (
              <TableRow>
                <AdminTableEmpty colSpan={4}>No live listings have favourites yet.</AdminTableEmpty>
              </TableRow>
            ) : null}
          </TableBody>
        </AdminTable>
      </section>
    </>
  );
}
