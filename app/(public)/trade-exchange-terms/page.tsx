import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trade Exchange terms (draft)",
  robots: { index: false, follow: false },
};

export default function TradeExchangeTermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-sm leading-6 text-text-secondary">
      <p className="font-semibold uppercase tracking-wide text-text-error">Draft — not legally approved and not in force</p>
      <h1 className="text-3xl font-bold text-text-primary">Trade Exchange supplemental terms</h1>
      <p>
        This draft explains the intended rules for a private dealer-to-dealer area on iTrader.im. It does not change the current <Link className="underline" href="/dealer-terms">Dealer Terms</Link>, <Link className="underline" href="/acceptable-use">Acceptable Use Policy</Link>, <Link className="underline" href="/privacy">Privacy Policy</Link> or <Link className="underline" href="/refunds">Refund Policy</Link> until those documents are reviewed and published.
      </p>
      <h2 className="text-xl font-semibold text-text-primary">Who can use it</h2>
      <p>Trade Exchange is for Isle of Man vehicle traders with an active Dealer Pro subscription and a separate business approval. A company number is not enough. Dealer Starter members may apply, but cannot see trade stock until both conditions are met. Consumers and private sellers cannot use it.</p>
      <h2 className="text-xl font-semibold text-text-primary">Who contracts</h2>
      <p>iTrader provides the advertising and messaging tools. It does not buy, sell, broker or guarantee a vehicle, and it does not take payment for a trade vehicle. Any sale is between the dealers, off the platform. An offer marked accepted in principle is not a completed purchase.</p>
      <h2 className="text-xl font-semibold text-text-primary">Listings</h2>
      <p>Dealers must have authority to sell, describe condition and mileage accurately, and must not advertise written-off vehicles. Trade listings are not public retail listings and do not count towards the public listing allowance. There is no separate Trade Exchange listing fee in this draft. Moving a vehicle to the public site requires a separate public listing.</p>
      <h2 className="text-xl font-semibold text-text-primary">Information</h2>
      <p>Business evidence, registration numbers and VINs are limited to the people who need them for review or the listing. Messages and evidence are kept for operation, moderation and the retention period described in the Privacy Policy. iTrader may remove listings or suspend access for misuse.</p>
    </article>
  );
}
