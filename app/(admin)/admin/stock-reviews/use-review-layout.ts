"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
const QUERY = "(min-width: 1024px) and (orientation: landscape)";
function subscribe(callback: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}
export function useStockReviewLayout(queryReport: string | null, history: string) {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia?.(QUERY).matches ?? false, () => false);
  const queryKey = `${history}:${queryReport ?? ""}`;
  const [navigation, setNavigation] = useState({ queryKey, id: queryReport });
  if (navigation.queryKey !== queryKey) setNavigation({ queryKey, id: queryReport });
  useEffect(() => {
    const back = () => setNavigation({ queryKey, id: new URL(window.location.href).searchParams.get("report") });
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [queryKey]);
  function toggle(id: string) {
    const next = navigation.id === id ? null : id;
    setNavigation({ queryKey, id: next });
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("report", next); else url.searchParams.delete("report");
    url.searchParams.set("history", history);
    url.hash = next ? "stock-review-detail" : "stock-review-results";
    window.history.pushState(window.history.state, "", url);
  }
  return { wide, selectedId: navigation.queryKey === queryKey ? navigation.id : queryReport, toggle };
}
