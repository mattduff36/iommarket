export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { MarkSoldButton } from "@/app/(public)/dealer/dashboard/mark-sold-button";
import { RenewListingButton } from "@/components/marketplace/renew-listing-button";
import { expireStaleLiveListings } from "@/lib/listings/expiry";

const PAGE_SIZE = 20;
const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "PENDING",
  "APPROVED",
  "LIVE",
  "SOLD",
  "EXPIRED",
  "TAKEN_DOWN",
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type SortFilter = "newest" | "oldest" | "price_high" | "price_low";

const SORT_OPTIONS: SortFilter[] = ["newest", "oldest", "price_high", "price_low"];

function getSortOrder(sort: SortFilter) {
  if (sort === "oldest") return { createdAt: "asc" as const };
  if (sort === "price_high") return { price: "desc" as const };
  if (sort === "price_low") return { price: "asc" as const };
  return { createdAt: "desc" as const };
}

function buildHref({
  status,
  sort,
  page,
}: {
  status: StatusFilter;
  sort: SortFilter;
  page: number;
}) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (sort !== "newest") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/account/listings?${query}` : "/account/listings";
}

interface Props {
  searchParams?: Promise<{
    status?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function AccountListingsPage({ searchParams }: Props) {
  await expireStaleLiveListings();
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up?next=/account/listings");

  const params = searchParams ? await searchParams : {};
  const status = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : "ALL";
  const sort = SORT_OPTIONS.includes(params.sort as SortFilter)
    ? (params.sort as SortFilter)
    : "newest";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const where = {
    userId: user.id,
    ...(status !== "ALL" ? { status } : {}),
  };

  const [listings, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: getSortOrder(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true } },
        region: { select: { name: true } },
        statusEvents: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, fromStatus: true, toStatus: true },
        },
        payments: {
          where: { status: "SUCCEEDED", type: "LISTING" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    db.listing.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          My Listing History
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          View all listings you have created, with latest lifecycle updates.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((item) => (
            <Link
              key={item}
              href={buildHref({ status: item, sort, page: 1 })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                status === item
                  ? "border-neon-blue-500 bg-neon-blue-500/10 text-neon-blue-400"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {item}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {SORT_OPTIONS.map((item) => (
              <Link
                key={item}
                href={buildHref({ status, sort: item, page: 1 })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                  sort === item
                    ? "border-premium-gold-500 bg-premium-gold-500/10 text-premium-gold-500"
                    : "border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {item.replace("_", " ")}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {listings.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Status Change</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="font-medium max-w-[220px] truncate">
                  {listing.title}
                </TableCell>
                <TableCell>{listing.category.name}</TableCell>
                <TableCell>{listing.region.name}</TableCell>
                <TableCell>£{(listing.price / 100).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{listing.status}</Badge>
                </TableCell>
                <TableCell className="text-text-secondary text-xs">
                  {listing.statusEvents[0]
                    ? `${listing.statusEvents[0].fromStatus ?? "—"} -> ${listing.statusEvents[0].toStatus} (${listing.statusEvents[0].createdAt.toLocaleDateString("en-GB")})`
                    : "—"}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {listing.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/listings/${listing.id}`}
                      className="text-sm text-text-trust hover:underline"
                    >
                      View
                    </Link>
                    {listing.status === "LIVE" &&
                      !listing.featured &&
                      (listing.dealerId !== null || listing.payments.length > 0) && (
                      <FeaturedUpgradeButton
                        listingId={listing.id}
                        variant="inline"
                      />
                    )}
                    {listing.status === "LIVE" && (
                      <MarkSoldButton listingId={listing.id} />
                    )}
                    {listing.status === "EXPIRED" && (
                      <RenewListingButton
                        listingId={listing.id}
                        flow={listing.dealerId ? "dealer" : "private"}
                        variant="inline"
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-text-secondary">
          No listings found for this filter.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between text-sm">
        <p className="text-text-secondary">
          Page {page} of {totalPages} · {total} listing{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Link
              href={buildHref({ status, sort, page: page - 1 })}
              className="text-text-trust hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span className="text-text-tertiary">Previous</span>
          )}
          {page < totalPages ? (
            <Link
              href={buildHref({ status, sort, page: page + 1 })}
              className="text-text-trust hover:underline"
            >
              Next
            </Link>
          ) : (
            <span className="text-text-tertiary">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
