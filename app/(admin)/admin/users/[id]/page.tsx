export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { UserActions } from "../user-actions";

export const metadata: Metadata = { title: "User Detail | Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_BADGE: Record<string, "success" | "warning" | "error" | "neutral" | "info"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  APPROVED: "info",
  LIVE: "success",
  EXPIRED: "error",
  TAKEN_DOWN: "error",
  SOLD: "neutral",
};

export default async function AdminUserDetailPage({ params }: Props) {
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      region: true,
      dealerProfile: {
        include: {
          subscriptions: { orderBy: { createdAt: "desc" }, take: 5 },
          _count: { select: { listings: true } },
        },
      },
      _count: {
        select: {
          listings: true,
          favourites: true,
          savedSearches: true,
          reports: true,
          listingViews: true,
        },
      },
    },
  });

  if (!user) notFound();

  const recentListings = await db.listing.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true, createdAt: true, price: true },
  });

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/users"
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          &larr; Users
        </Link>
        <h1 className="text-2xl font-bold text-text-primary">
          {user.name ?? user.email}
        </h1>
        {user.disabledAt && <Badge variant="error">Disabled</Badge>}
      </div>

      {/* Actions */}
      <div className="mb-6">
        <UserActions
          userId={user.id}
          currentRole={user.role}
          isDisabled={!!user.disabledAt}
        />
      </div>

      {/* Profile grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Role</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={user.role === "ADMIN" ? "warning" : user.role === "DEALER" ? "info" : "neutral"}>
              {user.role}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Region</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-primary">{user.region?.name ?? "Not set"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Listings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{user._count.listings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Joined</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-primary">
              {user.createdAt.toLocaleDateString("en-GB")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Account details */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-text-secondary w-32">Email:</span>
            <span className="text-text-primary">{user.email}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-secondary w-32">Auth User ID:</span>
            <span className="text-text-tertiary font-mono text-xs">{user.authUserId}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-secondary w-32">Favourites:</span>
            <span className="text-text-primary">{user._count.favourites}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-secondary w-32">Saved Searches:</span>
            <span className="text-text-primary">{user._count.savedSearches}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-secondary w-32">Reports Filed:</span>
            <span className="text-text-primary">{user._count.reports}</span>
          </div>
          {user.disabledAt && (
            <>
              <div className="flex gap-2">
                <span className="text-text-secondary w-32">Disabled At:</span>
                <span className="text-text-error">{user.disabledAt.toLocaleString("en-GB")}</span>
              </div>
              {user.disabledReason && (
                <div className="flex gap-2">
                  <span className="text-text-secondary w-32">Reason:</span>
                  <span className="text-text-error">{user.disabledReason}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Dealer profile */}
      {user.dealerProfile && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Dealer Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-text-secondary w-32">Name:</span>
              <span className="text-text-primary">{user.dealerProfile.name}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-text-secondary w-32">Slug:</span>
              <span className="text-text-tertiary font-mono">{user.dealerProfile.slug}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-text-secondary w-32">Verified:</span>
              <Badge variant={user.dealerProfile.verified ? "success" : "neutral"}>
                {user.dealerProfile.verified ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <span className="text-text-secondary w-32">Dealer Listings:</span>
              <span className="text-text-primary">{user.dealerProfile._count.listings}</span>
            </div>
            {user.dealerProfile.phone && (
              <div className="flex gap-2">
                <span className="text-text-secondary w-32">Phone:</span>
                <span className="text-text-primary">{user.dealerProfile.phone}</span>
              </div>
            )}
            {user.dealerProfile.website && (
              <div className="flex gap-2">
                <span className="text-text-secondary w-32">Website:</span>
                <a href={user.dealerProfile.website} target="_blank" rel="noopener noreferrer" className="text-neon-blue-400 hover:underline">
                  {user.dealerProfile.website}
                </a>
              </div>
            )}
            {user.dealerProfile.subscriptions.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-text-primary mb-2">Subscriptions</p>
                {user.dealerProfile.subscriptions.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-3 text-xs text-text-secondary">
                    <Badge variant={sub.status === "ACTIVE" ? "success" : sub.status === "PAST_DUE" ? "warning" : "error"}>
                      {sub.status}
                    </Badge>
                    <span>ends {sub.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}</span>
                    <span className="text-text-tertiary font-mono">{sub.stripeSubscriptionId}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent listings */}
      <h2 className="text-lg font-semibold text-text-primary mb-4">Recent Listings</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentListings.map((listing) => (
            <TableRow key={listing.id}>
              <TableCell>
                <Link
                  href={`/listings/${listing.id}`}
                  className="text-sm text-text-primary hover:underline"
                >
                  {listing.title}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE[listing.status] ?? "neutral"}>
                  {listing.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                £{(listing.price / 100).toLocaleString()}
              </TableCell>
              <TableCell className="text-sm text-text-tertiary">
                {listing.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
            </TableRow>
          ))}
          {recentListings.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-text-tertiary py-8">
                No listings yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
