import { notFound } from "next/navigation";
import { updateTradeListingAction } from "@/actions/trade/listings";
import { TradeListingForm } from "@/components/trade/listing-form";
import { TradeNav } from "@/components/trade/trade-nav";
import { canEditTradeListing } from "@/lib/trade-exchange/decision";
import { getVisibleTradeListing } from "@/lib/trade-exchange/listings";
import { presentTradeListing } from "@/lib/trade-exchange/presenter";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function EditTradeListingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member" && session.actor.kind !== "admin") notFound();
  const { id } = await params;
  const listing = await getVisibleTradeListing(session.actor, id);
  if (!listing || !canEditTradeListing(session.actor, listing.dealerId)) notFound();
  const view = presentTradeListing(listing, {
    dealerId: session.actor.kind === "member" ? session.actor.dealerId : undefined,
    admin: session.actor.kind === "admin",
  }, { includeIdentity: true });
  return (
    <section className="max-w-3xl">
      <TradeNav />
      <h1 className="mb-6 text-3xl font-bold text-text-primary">Edit trade listing</h1>
      <TradeListingForm action={updateTradeListingAction.bind(null, id)} submitLabel="Save changes" initial={view} />
    </section>
  );
}
