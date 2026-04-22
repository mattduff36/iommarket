export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSellLandingPath } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { expireStaleLiveListings } from "@/lib/listings/expiry";

const ACTIVE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;

export default async function AccountDashboardPage() {
  await expireStaleLiveListings();
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up?next=/account");

  const [
    statusGroups,
    recentListings,
    recentEvents,
    favouritesCount,
    savedSearchCount,
    reviewCount,
  ] = await Promise.all([
    db.listing.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    db.listing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        price: true,
      },
    }),
    db.listingStatusEvent.findMany({
      where: { listing: { userId: user.id } },
      include: {
        listing: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.favourite.count({
      where: { userId: user.id },
    }),
    db.savedSearch.count({
      where: { userId: user.id },
    }),
    db.dealerReview.count({
      where: { reviewerUserId: user.id },
    }),
  ]);

  const counts = Object.fromEntries(
    statusGroups.map((item) => [item.status, item._count._all])
  );

  const totalListings = statusGroups.reduce((acc, item) => acc + item._count._all, 0);
  const activeListings = ACTIVE_STATUSES.reduce(
    (acc, status) => acc + (counts[status] ?? 0),
    0
  );
  const sellHref = getSellLandingPath(user.role) ?? "/sell";
  const quickStats = [
    {
      label: "Saved listings",
      value: favouritesCount,
      accent: "text-neon-blue-500",
    },
    {
      label: "Saved searches",
      value: savedSearchCount,
      accent: "text-premium-gold-500",
    },
    {
      label: "Dealer reviews",
      value: reviewCount,
      accent: "text-emerald-500",
    },
    {
      label: "Listings created",
      value: totalListings,
      accent: "text-text-primary",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
            Your Account
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Welcome back, {user.name || user.email}. Save favourites, keep searches handy,
            manage your profile, and start selling when you are ready.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/account/favourites">Saved listings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/account/saved-searches">Saved searches</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/account/profile">Profile &amp; Security</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={sellHref}>Start selling</Link>
          </Button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {quickStats.map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-text-secondary">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${item.accent}`}>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Saved listings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-secondary">
              Keep the vehicles you are tracking in one place and jump back in when you are
              ready.
            </p>
            <p className="text-2xl font-bold text-neon-blue-500">{favouritesCount}</p>
            <Button asChild size="sm">
              <Link href="/account/favourites">Open saved listings</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved searches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-secondary">
              Re-run your favourite filters in one click and keep tabs on fresh inventory.
            </p>
            <p className="text-2xl font-bold text-premium-gold-500">{savedSearchCount}</p>
            <Button asChild size="sm" variant="ghost">
              <Link href="/account/saved-searches">Open saved searches</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trusted dealer reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-secondary">
              Signed-in members can leave named dealer reviews to help other buyers make
              informed decisions.
            </p>
            <p className="text-2xl font-bold text-emerald-500">{reviewCount}</p>
            <Button asChild size="sm" variant="ghost">
              <Link href="/">Browse dealer profiles</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Selling tools</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              Your account is ready for private selling whenever you are. Start with a single
              listing, then return here to track progress and moderation updates.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={sellHref}>Start selling privately</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/account/listings">View listing history</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {user.role === "USER" ? (
          <Card>
            <CardHeader>
              <CardTitle>Become a dealer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">
                Need more active listings and a public dealer profile? Upgrade to a dealer
                subscription any time.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/dealer/subscribe?tier=STARTER">Choose Starter</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/dealer/subscribe?tier=PRO">Choose Pro</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/pricing">Compare Plans</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : user.role === "DEALER" && user.dealerProfile ? (
          <Card>
            <CardHeader>
              <CardTitle>Dealer tools</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">
                Manage your inventory, public profile, and active subscription from your dealer
                area.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/dealer/dashboard">Open dealer dashboard</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/dealer/profile">Manage dealer profile</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Admin tools</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">
                Jump into moderation, user management, and marketplace oversight from the admin
                area.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/admin">Open admin area</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/account/profile">Update profile</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {totalListings > 0 ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Total Listings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-text-primary">{totalListings}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Active</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-neon-blue-500">{activeListings}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Sold</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-premium-gold-500">{counts.SOLD ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Taken Down</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-text-secondary">{counts.TAKEN_DOWN ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Listings</CardTitle>
                <Link href="/account/listings" className="text-sm text-text-trust hover:underline">
                  See all
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentListings.length > 0 ? (
                  recentListings.map((listing) => (
                    <div
                      key={listing.id}
                      className="flex items-center justify-between rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">{listing.title}</p>
                        <p className="text-xs text-text-secondary">
                          £{(listing.price / 100).toLocaleString()} ·{" "}
                          {listing.createdAt.toLocaleDateString("en-GB")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="neutral">{listing.status}</Badge>
                        <Link
                          href={`/listings/${listing.id}`}
                          className="text-sm text-text-trust hover:underline"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">
                    You have not created any listings yet.{" "}
                    <Link href={sellHref} className="text-text-trust hover:underline">
                      Create your first listing
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Status Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentEvents.length > 0 ? (
                  recentEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-border p-3">
                      <p className="text-sm text-text-primary">
                        <span className="font-medium">{event.listing.title}</span>:{" "}
                        {event.fromStatus ? `${event.fromStatus} -> ` : ""}
                        {event.toStatus}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {event.createdAt.toLocaleString("en-GB")} · {event.source}
                      </p>
                      {event.notes ? (
                        <p className="mt-1 text-xs text-text-secondary">{event.notes}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">
                    Activity will appear here as your listings move through moderation and
                    lifecycle updates.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
