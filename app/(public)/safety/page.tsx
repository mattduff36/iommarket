import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Buyer Safety",
  description: "Safety guidance for buyers and sellers on iTrader.im.",
};

export default function SafetyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Buyer Safety Guidance
      </h1>
      <ul className="mt-6 space-y-3 text-sm text-text-secondary list-disc list-inside">
        <li>Meet in safe, public locations where possible.</li>
        <li>Inspect documents, service history, and vehicle condition carefully.</li>
        <li>Never send money without verifying the listing and seller identity.</li>
        <li>Use the report feature if anything looks suspicious.</li>
      </ul>
    </div>
  );
}
