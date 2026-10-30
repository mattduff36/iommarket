"use client";
import { Check } from "lucide-react";
import { stockWorkerCommandClass, stockWorkerCommandLabel, useStockWorkerControl } from "./worker-context";
import { useStockDealerSelection, type StockDealer } from "./worker-selection";
export function StockDealerPicker({ dealers, unavailable = [], retainOnDisconnect = false }: { retainOnDisconnect?: boolean; dealers: StockDealer[]; unavailable?: { id: string; name: string; reason: string }[] }) {
  const controls = useStockWorkerControl();
  const selection = useStockDealerSelection();
  if (!controls.online && !retainOnDisconnect) return null;
  return <section data-stock-review-editing={controls.pending ? "true" : undefined} className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-semibold text-text-primary">Choose dealers to scrape</h2>
      <span className="text-sm tabular-nums text-text-secondary">{selection.selected.length} selected</span>
    </div>
    <fieldset disabled={controls.pending || !controls.online} className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <legend className="sr-only">Enabled dealers with a Pro account</legend>
      {dealers.map(dealer => <label key={dealer.id} className="relative cursor-pointer">
        <input type="checkbox" className="peer sr-only" checked={selection.selected.includes(dealer.id)} onChange={() => selection.toggle(dealer.id)} />
        <span className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-sm font-medium text-text-primary transition-colors hover:border-neon-blue-400 peer-checked:border-neon-blue-400 peer-checked:bg-neon-blue-500/10 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-neon-blue-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 motion-reduce:transition-none">
          <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selection.selected.includes(dealer.id) ? "border-neon-blue-400 bg-neon-blue-600 text-white" : "border-border text-transparent"}`}><Check size={14} strokeWidth={3} /></span>
          <span className="min-w-0 break-words">{dealer.name}</span>
        </span>
      </label>)}
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={!selection.canAct} onClick={selection.startOrStop} className={stockWorkerCommandClass(controls.running)}>
        {stockWorkerCommandLabel({ ...controls, pendingCommand: Boolean(controls.pendingCommand) })}
      </button>
      {dealers.length ? <button type="button" disabled={controls.pending || !controls.online} onClick={selection.selected.length === dealers.length ? selection.clear : selection.selectAll} className="min-h-11 rounded-md px-3 text-sm text-neon-blue-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-blue-400 disabled:opacity-50">{selection.selected.length === dealers.length ? "Clear selection" : "Select all"}</button> : <p className="text-sm text-text-secondary">No dealers have a verified website source.</p>}
    </div>
    {unavailable.length ? <details className="text-sm text-text-secondary"><summary className="cursor-pointer py-2">Unavailable dealers ({unavailable.length})</summary><ul className="mt-2 space-y-2">{unavailable.map(dealer => <li key={dealer.id}><span className="font-medium">{dealer.name}</span> · {dealer.reason}</li>)}</ul></details> : null}
    {selection.message ? <p role="status" className="text-sm text-text-secondary">{selection.message}</p> : null}
  </section>;
}
