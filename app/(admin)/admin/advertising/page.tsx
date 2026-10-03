import type { Metadata } from "next";
import { advertisingDiagnostics } from "@/lib/advertising/config";
import { isSearchIndexingEnabled, PREVIEW_INDEX_REMOVAL_PHASE } from "@/lib/seo/indexing-policy";

export const metadata: Metadata = {
  title: "Advertising diagnostics",
  robots: { index: false, follow: false },
};

export default function AdvertisingDiagnosticsPage() {
  const diagnostics = advertisingDiagnostics();
  const rows = [
    ["Deployment", diagnostics.deployment],
    ["Search indexing", isSearchIndexingEnabled() ? "enabled" : "blocked"],
    ["Preview removal phase", PREVIEW_INDEX_REMOVAL_PHASE],
    ["Advertising delivery", diagnostics.mode],
    ["Delivery reason", diagnostics.reason],
    ["Meta configured", diagnostics.metaConfigured ? "yes" : "no"],
    ["GA4 configured", diagnostics.ga4Configured ? "yes" : "no"],
    ["Google Ads configured", diagnostics.googleAdsConfigured ? "yes" : "no"],
    ["Advanced matching", "off"],
    ["Provider secret present", diagnostics.tokenPresent ? "yes" : "no"],
  ];

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold text-text-primary">Advertising diagnostics</h1>
      <p className="text-sm leading-relaxed text-text-secondary">
        Delivery stays off until this deployment has an explicit test or live destination.
        Preview cannot select the live destination. Untracked visits are unknown, not a measured zero.
        Provider secrets are not shown here.
      </p>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-2">
            <dt className="text-sm text-text-secondary">{label}</dt>
            <dd className="text-sm font-medium text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
