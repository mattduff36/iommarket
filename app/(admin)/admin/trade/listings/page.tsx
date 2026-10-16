import { CarFront } from "lucide-react";
import Link from "@/components/navigation/link";
import { AdminPager } from "@/components/admin/admin-pager";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";
import { notFound } from "next/navigation";
import { adminTradeListingStatusAction } from "@/actions/trade/admin";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { TradeBackLink, TradeListingBadge } from "@/components/admin/trade-admin-ui";
import { TradeForm } from "@/components/trade/trade-form";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export const dynamic = "force-dynamic";

export default async function AdminTradeListingsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!isTradeExchangeEnabled()) notFound();
  const page = parseAdminPage((await searchParams).page);
  const where = { status: { in: ["LIVE", "RESERVED", "PENDING_REVIEW"] as Array<"LIVE" | "RESERVED" | "PENDING_REVIEW"> } };
  const total = await db.tradeListing.count({ where });
  const listings = await db.tradeListing.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 25,
    skip: (page - 1) * 25,
    select: { id: true, status: true, year: true, make: true, model: true, dealer: { select: { name: true } } },
  });
  return (
    <section>
      <AdminPageHeader
        title="Trade listings"
        description="Hold a listing for review or remove it. Registration numbers stay on the dealer listing page."
        actions={<TradeBackLink href="/admin/trade">Trade Exchange</TradeBackLink>}
      />
      {listings.length === 0 ? (
        <AdminEmptyState icon={CarFront} title="No live trade stock" description="Live, reserved and pending-review listings appear here." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {listings.map((listing) => (
            <li key={listing.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <Link href={`/dealer/trade/listings/${listing.id}`} className="font-medium text-text-primary underline underline-offset-4">{listing.year} {listing.make} {listing.model}</Link>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                  <span>{listing.dealer.name}</span>
                  <TradeListingBadge status={listing.status} />
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {listing.status === "PENDING_REVIEW" ? (
                  <TradeForm
                    className="space-y-2"
                    variant="ghost"
                    action={adminTradeListingStatusAction.bind(null, listing.id, "LIVE")}
                    submitLabel="Release"
                    successMessage="Listing released."
                  >
                    <span className="sr-only">Release {listing.year} {listing.make} {listing.model}</span>
                  </TradeForm>
                ) : (
                  <TradeForm
                    className="space-y-2"
                    variant="ghost"
                    action={adminTradeListingStatusAction.bind(null, listing.id, "PENDING_REVIEW")}
                    submitLabel="Hold for review"
                    successMessage="Listing held for review."
                  >
                    <span className="sr-only">Hold {listing.year} {listing.make} {listing.model}</span>
                  </TradeForm>
                )}
                <TradeForm
                  className="space-y-2"
                  variant="ghost"
                  action={adminTradeListingStatusAction.bind(null, listing.id, "REMOVED")}
                  submitLabel="Remove"
                  successMessage="Listing removed."
                >
                  <span className="sr-only">Remove {listing.year} {listing.make} {listing.model}</span>
                </TradeForm>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AdminPager page={page} totalPages={adminTotalPages(total, 25)} hrefForPage={(next) => `/admin/trade/listings?page=${next}`} />
    </section>
  );
}

