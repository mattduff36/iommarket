"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  const scrollToResult = useRef<string | null>(null);
  useEffect(() => {
    const id = scrollToResult.current;
    if (!id || navigation.id !== id) return;
    scrollToResult.current = null;
    const target = document.getElementById(wide ? "stock-review-pane" : `stock-review-result-${id}`);
    target?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [navigation, wide]);
  function toggle(id: string) {
    const next = navigation.id === id ? null : id;
    scrollToResult.current = next;
    setNavigation({ queryKey, id: next });
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("report", next); else url.searchParams.delete("report");
    url.searchParams.set("history", history);
    url.hash = next ? "stock-review-detail" : "stock-review-results";
    window.history.pushState(window.history.state, "", url);
  }
  return { wide, selectedId: navigation.queryKey === queryKey ? navigation.id : queryReport, toggle };
}
