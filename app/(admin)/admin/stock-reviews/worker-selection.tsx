"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { enqueueDealerStockScrape } from "@/actions/admin/dealer-stock-sync";
import type { StockWorkerControl } from "./worker-context";
export type StockDealer = { id: string; name: string };
export function useDealerSelection(dealers: StockDealer[], controls: StockWorkerControl, hasQueuedWork = false) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const eligible = selected.filter(id => dealers.some(dealer => dealer.id === id));
  const canAct = controls.canCommand && (controls.running || eligible.length > 0 || hasQueuedWork);
  function startOrStop() {
    if (!canAct) return;
    if (controls.running) { controls.command("stop"); return; }
    const target = controls.target;
    const chosen = dealers.filter(dealer => eligible.includes(dealer.id));
    if (!controls.tryAcquire()) return;
    setMessage("");
    void (async () => {
      const queued: string[] = [];
      const failures: string[] = [];
      try {
        for (const dealer of chosen) {
          try {
            const result = await enqueueDealerStockScrape({ dealerId: dealer.id });
            if (result.error) failures.push(`${dealer.name}: ${result.error}`);
            else queued.push(dealer.id);
          } catch {
            failures.push(`${dealer.name}: request outcome is uncertain. Check run history before trying again.`);
          }
        }
        setSelected(current => current.filter(id => !queued.includes(id)));
        if (!queued.length && !(hasQueuedWork && chosen.length === 0)) { setMessage(`No dealer scans were queued. ${failures.join(" ")}`); return; }
        const outcome = await controls.dispatch("start", target);
        const issue = outcome === "ok" ? "" : outcome === "uncertain"
          ? "Start outcome is uncertain. Check the worker before retrying."
          : "The worker was not started. Check the connection before retrying.";
        setMessage([...failures, issue].filter(Boolean).join(" "));
      } finally { controls.release(); router.refresh(); }
    })();
  }
  return { selected: eligible, message, canAct, startOrStop,
    toggle: (id: string) => { if (!controls.pending) setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); },
    selectAll: () => { if (!controls.pending) setSelected(dealers.map(dealer => dealer.id)); },
    clear: () => { if (!controls.pending) setSelected([]); },
  };
}
const SelectionContext = createContext<ReturnType<typeof useDealerSelection> | null>(null);
export function StockDealerSelectionProvider({ value, children }: { value: ReturnType<typeof useDealerSelection>; children: ReactNode }) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
export function useStockDealerSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("Dealer selection requires the stock dashboard.");
  return value;
}
