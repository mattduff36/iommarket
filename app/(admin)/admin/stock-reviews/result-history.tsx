"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

const HiddenResults = createContext<ReadonlySet<string>>(new Set());
const HISTORY_EVENT = "stock-review-history";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(HISTORY_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(HISTORY_EVENT, listener); };
}
function parseIds(raw: string | null): string[] {
  try {
    const stored: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && id.length < 160).slice(-500) : [];
  } catch { return []; }
}

export function StockResultHistory({ adminId, clearableIds, children }: {
  adminId: string; clearableIds: string[]; children: ReactNode;
}) {
  const key = "stock-review-hidden:v1:" + adminId;
  const stored = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; }
  }, () => null);
  const [fallback, setFallback] = useState<string | null>(null);
  const saved = parseIds(fallback ?? stored);
  const hidden = new Set(saved.filter(id => clearableIds.includes(id)));
  function save(ids: string[]) {
    const encoded = JSON.stringify(ids);
    try { localStorage.setItem(key, encoded); setFallback(null); window.dispatchEvent(new Event(HISTORY_EVENT)); }
    catch { setFallback(encoded); }
  }
  return <HiddenResults.Provider value={hidden}>
    <div className="flex flex-wrap items-center gap-3">
      <h2 id="stock-review-results" className="text-xl font-semibold text-text-primary">Results</h2>
      <button type="button" disabled={stored === null || clearableIds.every(id => hidden.has(id))}
        onClick={() => save([...new Set([...saved, ...clearableIds])].slice(-500))}
        className="min-h-11 rounded-md border border-border px-3 text-sm text-text-primary hover:bg-surface-elevated disabled:opacity-50">
        Clear completed results
      </button>
      {hidden.size > 0 ? <button type="button" onClick={() => save([])}
        className="min-h-11 rounded-md px-3 text-sm text-neon-blue-400 hover:underline">Show cleared results ({hidden.size})</button> : null}
    </div>
    <p className="text-sm text-text-secondary">Clears completed results from this browser. History is retained. Pending reviews and active jobs stay visible; use “Reject and clear” to dismiss a pending review.</p>
    {fallback !== null ? <p role="status" className="text-sm text-text-secondary">Results are cleared for this visit. Browser storage is unavailable.</p> : null}
    {children}
  </HiddenResults.Provider>;
}

export function StockResultVisibility({ ids, children }: { ids: string[]; children: ReactNode }) {
  const hidden = useContext(HiddenResults);
  return ids.length > 0 && ids.every(id => hidden.has(id)) ? null : children;
}
