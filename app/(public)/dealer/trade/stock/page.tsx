import Link from "@/components/navigation/link";
import { notFound } from "next/navigation";
import { TradeNav } from "@/components/trade/trade-nav";
import { listOwnTradeStock } from "@/lib/trade-exchange/listings";
import { formatTradePrice, presentTradeListing } from "@/lib/trade-exchange/presenter";
import { tradeStockSummary } from "@/lib/trade-exchange/maintenance";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeStockPage() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") notFound();
  const [rows, summary] = await Promise.all([
    listOwnTradeStock(session.actor),
    tradeStockSummary(session.actor.dealerId),
  ]);
  const stock = rows.map((row) => presentTradeListing(row, { dealerId: session.actor.kind === "member" ? session.actor.dealerId : undefined }));
  return (
    <section>
      <TradeNav />
      <h1 className="text-3xl font-bold text-text-primary">My trade stock</h1>
      <p className="mt-2 text-sm text-text-secondary">{summary.live} live · {summary.drafts} drafts · {summary.enquiries} open enquiries · {summary.stale} needing an availability check</p>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {stock.length === 0 ? <li className="p-4 text-sm text-text-secondary">No trade listings yet.</li> : stock.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link className="font-medium text-text-primary underline" href={`/dealer/trade/listings/${item.id}`}>{item.year} {item.make} {item.model}</Link>
              <p className="text-sm text-text-secondary">{item.status} · {formatTradePrice(item)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
