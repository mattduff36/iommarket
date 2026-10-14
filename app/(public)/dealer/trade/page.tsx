import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TradeNav } from "@/components/trade/trade-nav";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { tradeAccessHeading, TRADE_REASON_LABELS } from "@/lib/trade-exchange/copy";
import { canApplyForTrade } from "@/lib/trade-exchange/decision";
import { formatTradePrice, presentTradeListing } from "@/lib/trade-exchange/presenter";
import { searchLiveTradeListings } from "@/lib/trade-exchange/listings";
import { tradeStockSummary } from "@/lib/trade-exchange/maintenance";
import { loadTradeSession } from "@/lib/trade-exchange/session";
import { searchInputFromForm } from "@/lib/trade-exchange/form";
import { TRADE_FUELS, TRADE_TRANSMISSIONS } from "@/lib/trade-exchange/constants";

function ageLabel(iso: string | null) {
  if (!iso) return "New";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export default async function TradeExchangePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await loadTradeSession();
  if (session.actor.kind === "admin") redirect("/admin/trade");
  if (session.actor.kind !== "member" && session.actor.kind !== "applicant") notFound();
  if (session.actor.kind === "applicant") {
    const membership = await db.tradeMembership.findUnique({
      where: { dealerId: session.actor.dealerId },
      select: { reasonCode: true },
    });
    const reason = membership?.reasonCode ? TRADE_REASON_LABELS[membership.reasonCode] : null;
    return (
      <section className="max-w-2xl">
        <h1 className="text-3xl font-bold text-text-primary">Trade Exchange</h1>
        <p className="mt-3 text-text-secondary">
          A private place for approved Isle of Man motor traders to offer part-exchange and clearance stock to each other. Trade stock is never shown on the public marketplace.
        </p>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{tradeAccessHeading(session.actor)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-text-secondary">
            <p>
              {session.actor.membershipStatus === "PENDING"
                ? "Your application has been submitted. iTrader will review the business and your authority to act. Trade stock stays hidden until that review is approved and Dealer Pro is active."
                : "Dealer Starter can apply in advance. Browsing and listing start only after Dealer Pro is active and iTrader has approved the business."}
            </p>
            {reason ? <p>{reason}</p> : null}
            <div className="flex flex-wrap gap-3">
              {canApplyForTrade(session.actor) ? <Link className={buttonVariants()} href="/dealer/trade/apply">Apply</Link> : null}
              {!session.actor.proEntitled ? <Link className={buttonVariants({ variant: "ghost" })} href="/dealer/subscribe">View Dealer Pro</Link> : null}
              <Link className={buttonVariants({ variant: "ghost" })} href="/trade-exchange-terms">Draft terms</Link>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const params = searchParams ? await searchParams : {};
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") form.set(key, value);
  }
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const result = await searchLiveTradeListings(session.actor, searchInputFromForm(form), page);
  const summary = await tradeStockSummary(session.actor.dealerId);
  if ("error" in result) notFound();
  const cards = result.listings.map((listing) => presentTradeListing(listing, { dealerId: session.actor.kind === "member" ? session.actor.dealerId : undefined }));

  return (
    <section>
      <TradeNav />
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Trade Exchange</h1>
          <p className="mt-1 text-sm text-text-secondary">{summary.live} live, {summary.drafts} drafts, {summary.enquiries} open enquiries, {summary.stale} due for an availability check.</p>
        </div>
      </div>
      <form className="mb-6 grid gap-3 sm:grid-cols-4" method="get">
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="make" placeholder="Make" aria-label="Make" defaultValue={String(params.make ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="model" placeholder="Model" aria-label="Model" defaultValue={String(params.model ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="minYear" placeholder="Year from" aria-label="Year from" defaultValue={String(params.minYear ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="maxYear" placeholder="Year to" aria-label="Year to" defaultValue={String(params.maxYear ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="minMileage" placeholder="Mileage from" aria-label="Mileage from" defaultValue={String(params.minMileage ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="maxMileage" placeholder="Mileage to" aria-label="Mileage to" defaultValue={String(params.maxMileage ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="minPriceGbp" placeholder="Price from £" aria-label="Minimum price" defaultValue={String(params.minPriceGbp ?? "")} />
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="maxPriceGbp" placeholder="Price to £" aria-label="Maximum price" defaultValue={String(params.maxPriceGbp ?? "")} />
        <select className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="transmission" aria-label="Transmission" defaultValue={String(params.transmission ?? "")}>
          <option value="">Any transmission</option>
          {TRADE_TRANSMISSIONS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="fuel" aria-label="Fuel" defaultValue={String(params.fuel ?? "")}>
          <option value="">Any fuel</option>
          {TRADE_FUELS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input className="rounded-md border border-border bg-surface px-3 py-2 text-sm" name="condition" placeholder="Condition" aria-label="Condition" defaultValue={String(params.condition ?? "")} />
        <button className={buttonVariants()} type="submit">Filter</button>
      </form>
      {cards.length === 0 ? <p className="text-text-secondary">No live trade stock matches these filters.</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.id}>
              <Link href={`/dealer/trade/listings/${card.id}`} className="block overflow-hidden rounded-xl border border-border bg-surface">
                {card.images[0] ? (
                  // Authenticated trade photos are served by a private route, not a public image CDN.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/trade/images/${card.images[0].id}`} alt="" className="aspect-[4/3] w-full object-cover" />
                ) : <div className="aspect-[4/3] bg-background" />}
                <div className="space-y-1 p-4">
                  <p className="font-semibold text-text-primary">{card.year} {card.make} {card.model}</p>
                  <p className="text-sm text-text-secondary">{card.mileage.toLocaleString("en-GB")} miles · {card.conditionSummary}</p>
                  <p className="text-sm text-text-primary">{formatTradePrice(card)} · {card.vatTreatment.replaceAll("_", " ")}</p>
                  <p className="text-sm text-text-secondary">{card.dealerName} · {card.locationLabel} · {ageLabel(card.publishedAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-text-secondary">{result.total} live listings</p>
    </section>
  );
}
