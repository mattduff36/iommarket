import { notFound } from "next/navigation";
import { createTradeListingAction } from "@/actions/trade/listings";
import { TradeListingForm } from "@/components/trade/listing-form";
import { TradeNav } from "@/components/trade/trade-nav";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function NewTradeListingPage() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") notFound();
  return (
    <section className="max-w-3xl">
      <TradeNav />
      <h1 className="mb-6 text-3xl font-bold text-text-primary">New trade listing</h1>
      <TradeListingForm action={createTradeListingAction} submitLabel="Save draft" />
    </section>
  );
}
