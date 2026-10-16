import { notFound } from "next/navigation";
import { importTradeListingsAction } from "@/actions/trade/listings";
import { TradeForm } from "@/components/trade/trade-form";
import { TradeNav } from "@/components/trade/trade-nav";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeImportPage() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") notFound();
  return (
    <section className="max-w-2xl">
      <TradeNav />
      <h1 className="text-3xl font-bold text-text-primary">Import drafts</h1>
      <p className="mt-2 text-sm text-text-secondary">
        CSV columns: make,model,year,mileage,transmission,fuel,condition,defects,priceType,priceGbp,vat,location,notes. Imports become drafts. Add a photo and the declarations before publishing. Up to 30 rows.
      </p>
      <div className="mt-6">
        <TradeForm action={importTradeListingsAction} submitLabel="Import drafts">
          <label className="text-sm font-medium text-text-primary">CSV file
            <input className="mt-1 block text-sm" type="file" name="file" accept=".csv,text/csv" required />
          </label>
        </TradeForm>
      </div>
    </section>
  );
}
