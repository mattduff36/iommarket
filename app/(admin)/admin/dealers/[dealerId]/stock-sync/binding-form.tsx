"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  enqueueDealerStockScrape,
  saveDealerStockBinding,
  setDealerStockBindingEnabled,
} from "@/actions/admin/dealer-stock-sync";
import { DEALER_STOCK_REGISTRY_OPTIONS } from "@/lib/dealer-stock-sync/registry-catalog";

export function StockBindingForm(input: {
  dealerId: string;
  registryKey: string | null;
  enabled: boolean;
  verified: boolean;
}) {
  const router = useRouter();
  const [registryKey, setRegistryKey] = useState(input.registryKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: unknown }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Could not update the binding.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => saveDealerStockBinding({ dealerId: input.dealerId, registryKey }));
      }}
    >
      <label className="block text-sm font-medium text-text-primary" htmlFor="registry-key">
        Website stock source
      </label>
      <select
        id="registry-key"
        name="registryKey"
        value={registryKey}
        onChange={(event) => setRegistryKey(event.target.value)}
        className="w-full max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm"
      >
        <option value="">Select a registry source</option>
        {DEALER_STOCK_REGISTRY_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="max-w-2xl text-sm text-text-secondary">
        The source is the registry entry you select here. Enabling weekly sync only queues work. Scrapes and approved applies run in the background worker, which is not running from this page.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending || registryKey.length === 0}
          className="rounded-md bg-neon-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Save verified source
        </button>
        <button
          type="button"
          disabled={isPending || !input.verified}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() =>
            run(() => setDealerStockBindingEnabled({ dealerId: input.dealerId, enabled: !input.enabled }))
          }
        >
          {input.enabled ? "Disable weekly sync" : "Enable weekly sync"}
        </button>
        <button
          type="button"
          disabled={isPending || !input.verified}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => run(() => enqueueDealerStockScrape({ dealerId: input.dealerId }))}
        >
          Queue scrape
        </button>
      </div>
      {error ? (
        <p className="text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
