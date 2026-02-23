export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Analytics | Admin" };

export default async function AdminAnalyticsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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
    db.listing.count({ where: { status: "LIVE" } }),
    db.favourite.count(),
    db.savedSearch.count(),
    db.listing.findMany({
      where: { status: "LIVE" },
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
      where: { status: "LIVE" },
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
    db.listing.count({ where: { status: "LIVE", dealerId: { not: null } } }),
    db.listing.count({ where: { status: "LIVE", dealerId: null } }),
  ]);

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Analytics</h1>

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Views (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalViews30d.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Views (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalViews7d.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalUsers.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Live Listings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalListingsLive.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Total Favourites</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalFavourites.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Saved Searches</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{totalSavedSearches.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Dealer vs Private (live)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-primary">
              <span className="font-bold">{dealerListingCount}</span> dealer
              {" / "}
              <span className="font-bold">{privateListingCount}</span> private
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily views */}
      <h2 className="text-lg font-semibold text-text-primary mb-4">Daily Views (last 7 days)</h2>
      <div className="grid grid-cols-7 gap-2 mb-8">
        {recentViews.map((day) => {
          const date = new Date(day.day);
          return (
            <div key={day.day} className="rounded-lg border border-border bg-surface p-3 text-center">
              <p className="text-xs text-text-tertiary">
                {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
              </p>
              <p className="text-lg font-bold text-text-primary">{Number(day.count).toLocaleString()}</p>
            </div>
          );
        })}
        {recentViews.length === 0 && (
          <p className="col-span-7 text-center text-text-tertiary py-4">No view data yet.</p>
        )}
      </div>

      {/* Top by views */}
      <h2 className="text-lg font-semibold text-text-primary mb-4">Top Listings by Views</h2>
      <Table>
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
              <TableCell className="text-sm text-text-tertiary">{i + 1}</TableCell>
              <TableCell className="text-sm text-text-primary">{listing.title}</TableCell>
              <TableCell className="text-sm text-text-secondary">
                {listing.dealer?.name ?? listing.user.email}
              </TableCell>
              <TableCell className="text-sm font-medium text-text-primary">
                {listing.viewCount.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Top by favourites */}
      <h2 className="text-lg font-semibold text-text-primary mt-8 mb-4">Top Listings by Favourites</h2>
      <Table>
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
              <TableCell className="text-sm text-text-tertiary">{i + 1}</TableCell>
              <TableCell className="text-sm text-text-primary">{listing.title}</TableCell>
              <TableCell className="text-sm text-text-secondary">
                {listing.dealer?.name ?? listing.user.email}
              </TableCell>
              <TableCell className="text-sm font-medium text-text-primary">
                {listing._count.favouritedBy}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
