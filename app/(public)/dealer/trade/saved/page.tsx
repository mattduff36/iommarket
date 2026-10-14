import { notFound } from "next/navigation";
import { deleteTradeSearchAction, saveTradeSearchAction } from "@/actions/trade/listings";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";
import { TradeNav } from "@/components/trade/trade-nav";
import { Button } from "@/components/ui/button";
import { listTradeSearches } from "@/lib/trade-exchange/saved-searches";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeSavedSearchPage() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") notFound();
  const searches = await listTradeSearches(session.actor);
  return (
    <section className="max-w-2xl">
      <TradeNav />
      <h1 className="text-3xl font-bold text-text-primary">Saved searches</h1>
      <p className="mt-2 text-sm text-text-secondary">Alerts say how many new matches there are. They do not include the vehicles.</p>
      <div className="mt-6">
        <TradeForm action={saveTradeSearchAction} submitLabel="Save search">
          <label className="flex flex-col gap-1 text-sm font-medium">Name
            <input name="name" required minLength={2} className={tradeFieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Make
            <input name="make" className={tradeFieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Model
            <input name="model" className={tradeFieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Maximum price (£)
            <input name="maxPriceGbp" className={tradeFieldClass} />
          </label>
        </TradeForm>
      </div>
      <ul className="mt-6 space-y-3">
        {searches.map((search) => (
          <li key={search.id} className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm text-text-primary">{search.name}</span>
            <form action={async () => { await deleteTradeSearchAction(search.id); }}><Button type="submit" variant="ghost">Delete</Button></form>
          </li>
        ))}
      </ul>
    </section>
  );
}
