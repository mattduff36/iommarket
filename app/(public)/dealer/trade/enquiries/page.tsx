import Link from "next/link";
import { notFound } from "next/navigation";
import { TradeNav } from "@/components/trade/trade-nav";
import { listTradeEnquiries } from "@/lib/trade-exchange/enquiries";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeEnquiriesPage() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") notFound();
  const enquiries = await listTradeEnquiries(session.actor);
  return (
    <section>
      <TradeNav />
      <h1 className="text-3xl font-bold text-text-primary">Enquiries</h1>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {enquiries.length === 0 ? <li className="p-4 text-sm text-text-secondary">No enquiries yet.</li> : enquiries.map((enquiry) => (
          <li key={enquiry.id} className="p-4">
            <Link className="font-medium text-text-primary underline" href={`/dealer/trade/enquiries/${enquiry.id}`}>
              {enquiry.listing.year} {enquiry.listing.make} {enquiry.listing.model}
            </Link>
            <p className="text-sm text-text-secondary">{enquiry.status}{enquiry.offerPence ? ` · offer £${(enquiry.offerPence / 100).toFixed(2)}` : ""}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
