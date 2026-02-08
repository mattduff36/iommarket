export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Plus, ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Dealer Dashboard",
  description: "Manage your dealer listings on itrader.im.",
};

const STATUS_VARIANT: Record<
  string,
  "neutral" | "warning" | "success" | "error" | "info"
> = {
  DRAFT: "neutral",
  PENDING: "warning",
  LIVE: "success",
  EXPIRED: "neutral",
  TAKEN_DOWN: "error",
};

export default async function DealerDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!user.dealerProfile) redirect("/pricing");

  const [listings, subscription] = await Promise.all([
    db.listing.findMany({
      where: { dealerId: user.dealerProfile.id },
      orderBy: { createdAt: "desc" },
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        category: { select: { name: true } },
        region: { select: { name: true } },
      },
    }),
    db.subscription.findFirst({
      where: {
        dealerId: user.dealerProfile.id,
        status: "ACTIVE",
      },
    }),
  ]);

  const liveCount = listings.filter((l) => l.status === "LIVE").length;
  const pendingCount = listings.filter((l) => l.status === "PENDING").length;
  const draftCount = listings.filter((l) => l.status === "DRAFT").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">
            Dealer Dashboard
          </h1>
          <p className="mt-1 text-text-secondary">
            Manage your listings and subscription
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/sell">
              <Plus className="h-4 w-4" />
              New Listing
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/dealers/${user.dealerProfile.slug}`}>
              <ExternalLink className="h-4 w-4" />
              View Profile
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Total Listings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {listings.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Live
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">{liveCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">
              {pendingCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Drafts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-secondary">
              {draftCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription status */}
      <Card className="mb-8">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-primary">
              Subscription:
            </span>
            {subscription ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="error">Inactive</Badge>
            )}
            {subscription?.currentPeriodEnd && (
              <span className="text-sm text-text-secondary">
                Renews{" "}
                {subscription.currentPeriodEnd.toLocaleDateString("en-GB")}
              </span>
            )}
          </div>
          {!subscription && (
            <Button asChild size="sm">
              <Link href="/pricing">Subscribe</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Listings table */}
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        Your Listings
      </h2>

      {listings.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="font-medium max-w-[200px] truncate">
                  {listing.title}
                </TableCell>
                <TableCell>{listing.category.name}</TableCell>
                <TableCell>{listing.region.name}</TableCell>
                <TableCell>
                  £{(listing.price / 100).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_VARIANT[listing.status] ?? "neutral"}
                  >
                    {listing.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-text-secondary">
                  {listing.expiresAt
                    ? listing.expiresAt.toLocaleDateString("en-GB")
                    : "—"}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/listings/${listing.id}`}
                    className="text-sm text-text-brand hover:underline"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-center py-16">
          <p className="text-text-secondary">
            No listings yet.{" "}
            <Link href="/sell" className="text-text-brand hover:underline">
              Create your first listing
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
