"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enqueueDealerStockScrape } from "@/actions/admin/dealer-stock-sync";

export function StockDealerPicker({ dealers }: { dealers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function queue() {
    const chosen = [...selected];
    setMessage("");
    startTransition(async () => {
      const queued: string[] = [];
      const failures: string[] = [];
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
      setMessage(`${queued.length} dealer scan${queued.length === 1 ? "" : "s"} queued.${failures.length ? ` ${failures.join(" ")}` : " Start the desktop worker when ready."}`);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold text-text-primary">Choose dealers to scrape</h2>
      <p className="text-sm text-text-secondary">Select the dealers you want to check. Only selected dealers are queued. The desktop worker processes queued jobs; weekly scheduling is separate.</p>
      <fieldset disabled={pending} className="flex flex-wrap gap-4">
        <legend className="sr-only">Dealers with a verified website source</legend>
        {dealers.map(dealer => (
          <label key={dealer.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(dealer.id)} onChange={event => setSelected(current => event.target.checked ? [...current, dealer.id] : current.filter(id => id !== dealer.id))} />
            {dealer.name}
          </label>
        ))}
      </fieldset>
      {dealers.length === 0 ? <p className="text-sm text-text-secondary">Set up a verified website source on the dealer’s stock page first.</p> : null}
      <button type="button" disabled={pending || selected.length === 0} onClick={queue} className="rounded-md bg-neon-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "Queuing…" : "Queue selected dealers"}
      </button>
      {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
    </section>
  );
}
