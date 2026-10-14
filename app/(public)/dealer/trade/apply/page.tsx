import { notFound, redirect } from "next/navigation";
import { TradeApplicationForm } from "@/components/trade/application-form";
import { tradeApplyDestination } from "@/lib/trade-exchange/decision";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export default async function TradeApplyPage() {
  const session = await loadTradeSession();
  const destination = tradeApplyDestination(session.actor);
  if (destination === "hidden") notFound();
  if (destination === "status") redirect("/dealer/trade");
  return (
    <section className="max-w-2xl">
      <h1 className="mb-2 text-3xl font-bold text-text-primary">Apply for Trade Exchange</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Approval is a manual check of the business and your authority to act. It is not an endorsement of any vehicle. Read the <a className="underline" href="/trade-exchange-terms">draft Trade Exchange terms</a>.
      </p>
      <TradeApplicationForm />
    </section>
  );
}
