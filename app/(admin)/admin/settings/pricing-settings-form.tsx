"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMarketplacePricing } from "@/actions/admin/settings";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { Input } from "@/components/ui/input";
import {
  MARKETPLACE_PRICING,
  type MarketplacePricing,
} from "@/lib/config/marketplace-pricing-definitions";
import { formatGbpFromPence, formatGbpInputFromPence } from "@/lib/formatting/gbp";

interface PricingSettingsFormProps {
  pricing: MarketplacePricing;
}

const PRICE_FIELDS = [
  {
    name: "privateListing",
    label: MARKETPLACE_PRICING.privateListing.label,
    period: "One-time per listing",
  },
  {
    name: "featuredUpgrade",
    label: MARKETPLACE_PRICING.featuredUpgrade.label,
    period: "One-time upgrade",
  },
  {
    name: "dealerStarterMonthly",
    label: MARKETPLACE_PRICING.dealerStarterMonthly.label,
    period: "Monthly subscription",
  },
  {
    name: "dealerProMonthly",
    label: MARKETPLACE_PRICING.dealerProMonthly.label,
    period: "Monthly subscription",
  },
] as const;

export function PricingSettingsForm({ pricing }: PricingSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    const input = {
      privateListing: String(formData.get("privateListing") ?? ""),
      featuredUpgrade: String(formData.get("featuredUpgrade") ?? ""),
      dealerStarterMonthly: String(formData.get("dealerStarterMonthly") ?? ""),
      dealerProMonthly: String(formData.get("dealerProMonthly") ?? ""),
      optionalListingSupport: formatGbpInputFromPence(
        pricing.optionalListingSupportPence,
      ),
    };

    startTransition(async () => {
      const result = await updateMarketplacePricing(input);
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat().join(", "),
        );
        return;
      }

      setSuccess("Marketplace prices updated.");
      router.refresh();
    });
  }

  const values = {
    privateListing: pricing.privateListingPence,
    featuredUpgrade: pricing.featuredUpgradePence,
    dealerStarterMonthly: pricing.dealerStarterMonthlyPence,
    dealerProMonthly: pricing.dealerProMonthlyPence,
  };

  return (
    <section className="mb-8 max-w-2xl rounded-lg border border-neon-blue-500/25 bg-surface p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary">Marketplace pricing</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Enter GBP amounts. They are stored as integer pence and used for both
          checkout requests and customer-facing price copy.
        </p>
      </div>

      <form action={handleSubmit} className="space-y-4">
        {PRICE_FIELDS.map((field) => {
          const pence = values[field.name];
          return (
            <div key={field.name} className="rounded-md border border-border p-3">
              <label
                htmlFor={field.name}
                className="block text-sm font-medium text-text-primary"
              >
                {field.label}
              </label>
              <p className="mt-0.5 text-xs text-text-secondary">
                {field.period} · currently {formatGbpFromPence(pence)}
              </p>
              <Input
                id={field.name}
                name={field.name}
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                defaultValue={formatGbpInputFromPence(pence)}
                className="mt-2"
                required
              />
            </div>
          );
        })}

        {error ? <p className="text-sm text-text-error" role="alert">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-500" role="status">{success}</p> : null}
        <AdminActionButton type="submit" disabled={isPending} tone="primary">
          Save marketplace prices
        </AdminActionButton>
      </form>
    </section>
  );
}
