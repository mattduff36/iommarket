export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModerationActions } from "./moderation-actions";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Moderate Listings" };

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "error" | "info" | "premium"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  APPROVED: "info",
  LIVE: "success",
  EXPIRED: "neutral",
  TAKEN_DOWN: "error",
  SOLD: "premium",
};

interface ListingReviewLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

function ListingReviewLink({ href, children, className }: ListingReviewLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      className={cn(
        "block h-full min-h-11 px-4 py-3 text-text-primary transition-colors group-hover:text-neon-blue-400",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export default async function AdminListingsPage() {
  await expireStaleLiveListings();
  const listings = await db.listing.findMany({
    orderBy: [
      { status: "asc" },
      { createdAt: "desc" },
    ],
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
      category: { select: { name: true } },
      region: { select: { name: true } },
      _count: { select: { reports: true } },
    },
  });

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">
        Listing Moderation
      </h1>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reports</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const reviewHref = `/listings/${listing.id}?adminReview=1`;

            return (
              <TableRow key={listing.id} className="group">
                <TableCell className="max-w-[200px] p-0 font-medium">
                  <ListingReviewLink href={reviewHref} className="truncate font-medium">
                    {listing.title}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0 text-text-secondary">
                  <ListingReviewLink href={reviewHref} className="text-text-secondary">
                    {listing.user.name ?? listing.user.email}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    {listing.category.name}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    £{(listing.price / 100).toLocaleString()}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    <Badge variant={STATUS_VARIANT[listing.status] ?? "neutral"}>
                      {listing.status}
                    </Badge>
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    {listing._count.reports > 0 ? (
                      <Badge variant="error">{listing._count.reports}</Badge>
                    ) : (
                      <span className="text-text-secondary">0</span>
                    )}
                  </ListingReviewLink>
                </TableCell>
                <TableCell>
                  <ModerationActions
                    listingId={listing.id}
                    currentStatus={listing.status}
                    featured={listing.featured}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {listings.length === 0 && (
        <p className="text-center py-8 text-text-secondary">
          No listings to moderate.
        </p>
      )}
    </>
  );
}
