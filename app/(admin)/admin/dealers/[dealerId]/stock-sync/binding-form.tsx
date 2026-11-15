"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  enqueueDealerStockScrape,
  saveDealerStockBinding,
  setDealerStockBindingEnabled,
} from "@/actions/admin/dealer-stock-sync";
import { useOptionalStockWorkerControl } from "../../../stock-reviews/worker-context";
import { DEALER_STOCK_REGISTRY_OPTIONS } from "@/lib/dealer-stock-sync/registry-catalog";

export function StockBindingForm(input: {
  dealerId: string;
  registryKey: string | null;
  enabled: boolean;
  verified: boolean;
}) {
  const router = useRouter();
  const worker = useOptionalStockWorkerControl();
  const [scraping, setScraping] = useState(false);
  const scrapeLock = useRef(false);
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

  async function scrape() {
    if (!worker?.requestRun || scrapeLock.current) return;
    scrapeLock.current = true;
    setScraping(true);
    setError(null);
    try {
      await worker.requestRun(async () => {
        const result = await enqueueDealerStockScrape({ dealerId: input.dealerId });
        if (result.error) { setError(result.error); return []; }
        router.refresh();
        return result.data?.jobId ? [result.data.jobId] : [];
      });
    } catch { setError("The scrape request outcome is uncertain. Check task results before trying again."); }
    finally { scrapeLock.current = false; setScraping(false); }
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
        The source is the registry entry you select here. Enabling weekly sync only queues work. Scrapes and approved changes need Stock Update. If it is not connected, you will be asked to open it before work is queued.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending || scraping || registryKey.length === 0}
          className="rounded-md bg-neon-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Save verified source
        </button>
        <button
          type="button"
          disabled={isPending || scraping || !input.verified}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() =>
            run(() => setDealerStockBindingEnabled({ dealerId: input.dealerId, enabled: !input.enabled }))
          }
        >
          {input.enabled ? "Disable weekly sync" : "Enable weekly sync"}
        </button>
        <button
          type="button"
          disabled={isPending || scraping || !input.verified || !worker?.requestRun || worker.pending || worker.stopping}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void scrape()}
        >
          Queue scrape
        </button>
      </div>
      {error ? (
        <ReportableError as="p" className="text-sm text-text-error" role="alert">
          {error}
        </ReportableError>
      ) : null}
    </form>
  );
}
