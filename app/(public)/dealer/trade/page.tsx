import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TradeNav } from "@/components/trade/trade-nav";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { tradeAccessHeading, TRADE_REASON_LABELS } from "@/lib/trade-exchange/copy";
import { canApplyForTrade } from "@/lib/trade-exchange/decision";
import { formatTradePrice, presentTradeListing } from "@/lib/trade-exchange/presenter";
import {
  listEligibleTradeSellers,
  searchLiveTradeListings,
  sanitizeTradeBrowsePage,
  tradeBrowseHref,
  tradeMembershipLabel,
  tradeVatLabel,
} from "@/lib/trade-exchange/listings";
import { tradeStockSummary } from "@/lib/trade-exchange/maintenance";
import { loadTradeSession } from "@/lib/trade-exchange/session";
import { searchInputFromForm } from "@/lib/trade-exchange/form";
import { TRADE_FUELS, TRADE_TRANSMISSIONS } from "@/lib/trade-exchange/constants";

const fieldClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500";

function ageLabel(iso: string | null) {
  if (!iso) return "New";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function paramText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function TradeFilters({
  filters,
  sellers,
}: {
  filters: Record<string, string>;
  sellers: Array<{ id: string; name: string }>;
}) {
  const dealerId = sellers.some((seller) => seller.id === filters.dealerId) ? filters.dealerId : "";
  return (
    <form className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
      <input className={fieldClass} name="make" placeholder="Make" aria-label="Make" defaultValue={filters.make} />
      <input className={fieldClass} name="model" placeholder="Model" aria-label="Model" defaultValue={filters.model} />
      <input className={fieldClass} name="minYear" placeholder="Year from" aria-label="Year from" defaultValue={filters.minYear} />
      <input className={fieldClass} name="maxYear" placeholder="Year to" aria-label="Year to" defaultValue={filters.maxYear} />
      <input className={fieldClass} name="minMileage" placeholder="Mileage from" aria-label="Mileage from" defaultValue={filters.minMileage} />
      <input className={fieldClass} name="maxMileage" placeholder="Mileage to" aria-label="Mileage to" defaultValue={filters.maxMileage} />
      <input className={fieldClass} name="minPriceGbp" placeholder="Price from £" aria-label="Minimum price" defaultValue={filters.minPriceGbp} />
      <input className={fieldClass} name="maxPriceGbp" placeholder="Price to £" aria-label="Maximum price" defaultValue={filters.maxPriceGbp} />
      <select className={fieldClass} name="transmission" aria-label="Transmission" defaultValue={filters.transmission}>
        <option value="">Any transmission</option>
        {TRADE_TRANSMISSIONS.map((item) => <option key={item}>{item}</option>)}
      </select>
      <select className={fieldClass} name="fuel" aria-label="Fuel" defaultValue={filters.fuel}>
        <option value="">Any fuel</option>
        {TRADE_FUELS.map((item) => <option key={item}>{item}</option>)}
      </select>
      <select className={fieldClass} name="dealerId" aria-label="Dealer" defaultValue={dealerId}>
        <option value="">Any dealer</option>
        {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
      </select>
      <input className={fieldClass} name="condition" placeholder="Condition" aria-label="Condition" defaultValue={filters.condition} />
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonVariants()} type="submit">Filter</button>
        <Link className={buttonVariants({ variant: "ghost" })} href="/dealer/trade">Clear filters</Link>
      </div>
    </form>
  );
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
          <CardContent className="space-y-4 text-sm text-text-secondary">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt>Dealer Pro</dt>
                <dd className="font-medium text-text-primary">{session.actor.proEntitled ? "Active" : "Not active"}</dd>
              </div>
              <div>
                <dt>Trade approval</dt>
                <dd className="font-medium text-text-primary">{tradeMembershipLabel(session.actor.membershipStatus)}</dd>
              </div>
            </dl>
            <p>
              {session.actor.membershipStatus === "PENDING"
                ? "Your application has been submitted. iTrader will review the business and your authority to act. Trade stock stays hidden until that review is approved and Dealer Pro is active."
                : "Dealer Starter can apply in advance. Browsing and listing start only after Dealer Pro is active and iTrader has approved the business."}
            </p>
            {reason ? <p>{reason}</p> : null}
            <div className="flex flex-wrap gap-3">
              {canApplyForTrade(session.actor) ? <Link className={buttonVariants()} href="/dealer/trade/apply">Apply</Link> : null}
              {!session.actor.proEntitled ? <Link className={buttonVariants({ variant: "ghost" })} href="/dealer/subscribe">View Dealer Pro</Link> : null}
              <Link className={buttonVariants({ variant: "ghost" })} href="/dealer/dashboard">Back to dashboard</Link>
              <Link className={buttonVariants({ variant: "ghost" })} href="/trade-exchange-terms">Draft terms</Link>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const viewerDealerId = session.actor.dealerId;
  const params = searchParams ? await searchParams : {};
  const filters = {
    make: paramText(params.make),
    model: paramText(params.model),
    minYear: paramText(params.minYear),
    maxYear: paramText(params.maxYear),
    minMileage: paramText(params.minMileage),
    maxMileage: paramText(params.maxMileage),
    minPriceGbp: paramText(params.minPriceGbp),
    maxPriceGbp: paramText(params.maxPriceGbp),
    transmission: paramText(params.transmission),
    fuel: paramText(params.fuel),
    condition: paramText(params.condition),
    dealerId: paramText(params.dealerId),
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(filters)) form.set(key, value);
  const page = sanitizeTradeBrowsePage(params.page);
  const [result, summary, sellers] = await Promise.all([
    searchLiveTradeListings(session.actor, searchInputFromForm(form), page),
    tradeStockSummary(session.actor.dealerId),
    listEligibleTradeSellers(),
  ]);
  if (filters.dealerId && !sellers.some(seller => seller.id === filters.dealerId)) {
    filters.dealerId = "";
    redirect(tradeBrowseHref(filters, 1));
  }
  const failed = "error" in result;
  const cards = failed ? [] : result.listings.map((listing) => presentTradeListing(listing, { dealerId: viewerDealerId }));
  const totalPages = failed ? 1 : Math.max(1, Math.ceil(result.total / result.pageSize));
  if (!failed && result.page > totalPages) redirect(tradeBrowseHref(filters, totalPages));

  return (
    <section>
      <TradeNav />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Trade Exchange</h1>
        <p className="mt-1 text-sm text-text-secondary">{summary.live} live, {summary.drafts} drafts, {summary.enquiries} open enquiries, {summary.stale} due for an availability check.</p>
      </div>
      {failed ? (
        <p role="alert" className="mb-4 text-sm text-text-error">
          {result.error} Clear the filters and try again.
        </p>
      ) : null}
      <TradeFilters filters={filters} sellers={sellers} />
      {failed ? null : cards.length === 0 ? <p className="text-text-secondary">No live trade stock matches these filters.</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.id}>
              <Link href={`/dealer/trade/listings/${card.id}`} className="block overflow-hidden rounded-xl border border-border bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500">
                {card.images[0] ? (
                  // Authenticated trade photos are served by a private route, not a public image CDN.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/trade/images/${card.images[0].id}`} alt={`${card.year} ${card.make} ${card.model}`} className="aspect-[4/3] w-full object-cover" />
                ) : <div className="aspect-[4/3] bg-background" />}
                <div className="space-y-1 p-4">
                  <p className="font-semibold text-text-primary">{card.year} {card.make} {card.model}</p>
                  <p className="text-sm text-text-secondary">{card.mileage.toLocaleString("en-GB")} miles · {card.conditionSummary}</p>
                  <p className="text-sm text-text-primary">{formatTradePrice(card)} · {tradeVatLabel(card.vatTreatment)}</p>
                  <p className="text-sm text-text-secondary">{card.dealerName} · {card.locationLabel} · {ageLabel(card.publishedAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {failed ? null : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-text-secondary">
            Page {result.page} of {totalPages} · {result.total} result{result.total === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {result.page > 1 ? (
              <Link href={tradeBrowseHref(filters, result.page - 1)} className="text-text-trust hover:underline">Previous</Link>
            ) : (
              <span className="text-text-tertiary">Previous</span>
            )}
            {result.page < totalPages ? (
              <Link href={tradeBrowseHref(filters, result.page + 1)} className="text-text-trust hover:underline">Next</Link>
            ) : (
              <span className="text-text-tertiary">Next</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
