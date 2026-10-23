"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enqueueDealerStockScrape } from "@/actions/admin/dealer-stock-sync";
import { stockWorkerCommandClass, stockWorkerCommandLabel, useStockWorkerControl } from "./worker-context";

export function StockDealerPicker({ dealers, unavailable = [] }: { dealers: { id: string; name: string }[]; unavailable?: { id: string; name: string; reason: string }[] }) {
  const router = useRouter();
  const controls = useStockWorkerControl();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const label = stockWorkerCommandLabel({
    pending: controls.pending,
    pendingCommand: Boolean(controls.pendingCommand),
    stopping: controls.stopping,
    running: controls.running,
  });

  function startOrStop() {
    if (controls.running) {
      controls.command("stop");
      return;
    }
    const chosen = [...selected];
    if (chosen.length === 0 || !controls.tryAcquire()) return;
    setMessage("");
    void (async () => {
      const queued: string[] = [];
      const failures: string[] = [];
      try {
        for (const id of chosen) {
          const name = dealers.find(dealer => dealer.id === id)?.name ?? "Dealer";
          try {
            const result = await enqueueDealerStockScrape({ dealerId: id });
            if (result.error) failures.push(`${name}: ${result.error}`);
            else queued.push(id);
          } catch {
            failures.push(`${name}: request outcome is uncertain. Check run history before trying again.`);
          }
        }
        setSelected(current => current.filter(id => !queued.includes(id)));
        const failureText = failures.length ? ` ${failures.join(" ")}` : "";
        if (queued.length === 0) {
          setMessage(`No dealer scans were queued.${failureText}`);
          return;
        }
        const started = await controls.dispatch("start");
        const summary = `${queued.length} dealer scan${queued.length === 1 ? "" : "s"} queued.`;
        if (started === "ok") setMessage(`${summary}${failureText}`);
        else if (started === "uncertain") setMessage(`${summary}${failureText} Start outcome is uncertain. Check the worker state before trying again.`);
        else setMessage(`${summary}${failureText} The worker was not started.`);
      } finally {
        controls.release();
        router.refresh();
      }
    })();
  }

  if (!controls.online) return null;

  return (
    <section data-stock-review-editing={controls.pending ? "true" : undefined} className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold text-text-primary">Choose dealers to scrape</h2>
      <p className="text-sm text-text-secondary">Select the dealers to check, then start the worker. Only selected dealers are queued, and the worker starts after those queues succeed. Weekly scheduling is separate.</p>
      <fieldset disabled={controls.pending} className="flex flex-wrap gap-4">
        <legend className="sr-only">Dealers with a verified website source</legend>
        {dealers.map(dealer => (
          <label key={dealer.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(dealer.id)} onChange={event => setSelected(current => event.target.checked ? [...current, dealer.id] : current.filter(id => id !== dealer.id))} />
            {dealer.name}
          </label>
        ))}
      </fieldset>
      {dealers.length === 0 ? <p className="text-sm text-text-secondary">Set up a verified website source on the dealer’s stock page first.</p> : null}
      <button type="button" disabled={!controls.canCommand || (!controls.running && selected.length === 0)} onClick={startOrStop} className={stockWorkerCommandClass(controls.running)}>
        {label}
      </button>
      {controls.pendingCommand ? <p className="text-xs text-text-secondary">{controls.pendingCommand.action === "start" ? "Start" : "Safe stop"} is awaiting acknowledgement from the app.</p> : null}
      {unavailable.length ? <details className="text-sm text-text-secondary">
        <summary className="cursor-pointer py-2">Other dealer profiles ({unavailable.length}) — why they are unavailable</summary>
        <ul className="mt-2 space-y-2">{unavailable.map(dealer => <li key={dealer.id}><span className="font-medium">{dealer.name}</span> · {dealer.reason}</li>)}</ul>
      </details> : null}
      {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
    </section>
  );
}
