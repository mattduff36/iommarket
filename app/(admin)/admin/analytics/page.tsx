export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";
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

export default async function AdminAnalyticsPage() {
  await expireStaleLiveListings();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const liveWhere = liveListingWhere(now);

  const [
    totalViews30d,
    totalViews7d,
    totalUsers,
    totalListingsLive,
    totalFavourites,
    totalSavedSearches,
    topByViews,
    topByFavourites,
    recentViews,
    dealerListingCount,
    privateListingCount,
  ] = await Promise.all([
    db.listingView.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    db.listingView.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    db.user.count(),
    db.listing.count({ where: liveWhere }),
    db.favourite.count(),
    db.savedSearch.count(),
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
    db.listing.findMany({
      where: liveWhere,
      orderBy: { favouritedBy: { _count: "desc" } },
      take: 10,
      select: {
        id: true,
        title: true,
        _count: { select: { favouritedBy: true } },
        dealer: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
    // Daily view counts for last 7 days (raw query for grouping)
    db.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT DATE("createdAt") as day, COUNT(*)::bigint as count
      FROM "ListingView"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY day DESC
    `,
    db.listing.count({ where: { ...liveWhere, dealerId: { not: null } } }),
    db.listing.count({ where: { ...liveWhere, dealerId: null } }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="Track marketplace engagement, audience growth, and the listings attracting attention."
        meta={<span>Live marketplace data</span>}
      />

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
