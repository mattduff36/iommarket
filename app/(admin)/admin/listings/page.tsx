export const dynamic = "force-dynamic";

import type { Metadata } from "next";
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

export default async function AdminListingsPage() {
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
          {listings.map((listing) => (
            <TableRow key={listing.id}>
              <TableCell className="font-medium max-w-[200px] truncate">
                {listing.title}
              </TableCell>
              <TableCell className="text-text-secondary">
                {listing.user.name ?? listing.user.email}
              </TableCell>
              <TableCell>{listing.category.name}</TableCell>
              <TableCell>
                £{(listing.price / 100).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[listing.status] ?? "neutral"}>
                  {listing.status}
                </Badge>
              </TableCell>
              <TableCell>
                {listing._count.reports > 0 && (
                  <Badge variant="error">{listing._count.reports}</Badge>
                )}
              </TableCell>
              <TableCell>
                <ModerationActions
                  listingId={listing.id}
                  currentStatus={listing.status}
                  featured={listing.featured}
                />
              </TableCell>
            </TableRow>
          ))}
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
