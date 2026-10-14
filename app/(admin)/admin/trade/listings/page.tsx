import { notFound } from "next/navigation";
import { adminTradeListingStatusAction } from "@/actions/trade/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export default async function AdminTradeListingsPage() {
  if (!isTradeExchangeEnabled()) notFound();
  const listings = await db.tradeListing.findMany({
    where: { status: { in: ["LIVE", "RESERVED", "PENDING_REVIEW"] } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, status: true, year: true, make: true, model: true, dealer: { select: { name: true } } },
  });
  return (
    <section>
      <AdminPageHeader title="Trade listings" description="Hold a listing for review or remove it. Registration numbers stay on the dealer listing page." />
      <ul className="divide-y divide-border rounded-xl border border-border">
        {listings.length === 0 ? <li className="p-4 text-sm text-text-secondary">No live trade stock.</li> : listings.map((listing) => (
          <li key={listing.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{listing.year} {listing.make} {listing.model}</p>
              <p className="text-sm text-text-secondary">{listing.dealer.name} · {listing.status}</p>
            </div>
            <div className="flex gap-2">
              {listing.status === "PENDING_REVIEW" ? (
                <form action={async () => { await adminTradeListingStatusAction(listing.id, "LIVE"); }}><Button type="submit" variant="ghost">Release</Button></form>
              ) : (
                <form action={async () => { await adminTradeListingStatusAction(listing.id, "PENDING_REVIEW"); }}><Button type="submit" variant="ghost">Hold</Button></form>
              )}
              <form action={async () => { await adminTradeListingStatusAction(listing.id, "REMOVED"); }}><Button type="submit" variant="ghost">Remove</Button></form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
