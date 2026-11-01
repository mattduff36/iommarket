"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const POLL_MS = 5_000;
const TIMEOUT_MS = 10_000;
const isVisible = () => document.visibilityState !== "hidden";
const RefreshContext = createContext<(() => void) | undefined>(undefined);

export const StockSnapshotRefreshProvider = RefreshContext.Provider;
export function useStockSnapshotRefresh() {
  return useContext(RefreshContext);
}

/** Background reads never replace the route or discard its last good data. */
export function useStockSnapshot<T>(
  initial: T,
  canCommit: () => boolean,
  isValid: (value: unknown) => value is T,
  pollInterval: (value: T) => number = () => POLL_MS,
) {
  const [snapshot, setSnapshot] = useState(initial);
  const [connectionLost, setConnectionLost] = useState(false);
  const callbacks = useRef({ canCommit, isValid, pollInterval });
  callbacks.current = { canCommit, isValid, pollInterval };
  const reloadRef = useRef<() => void>(() => {});
  const reload = useCallback(() => reloadRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let reloadQueued = false;
    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let deferred: { value: T } | undefined;
    let failures = 0;
    let nextPollAt = Date.now() + callbacks.current.pollInterval(initial);
    // A new server payload (including query navigation) supersedes old reads.
    setSnapshot(initial);
    setConnectionLost(false);

    function commitDeferred() {
      if (deferred && callbacks.current.canCommit()) {
        setSnapshot(deferred.value);
        deferred = undefined;
      }
    }

    async function poll(force = false) {
      if (stopped || !isVisible()) return;
      commitDeferred();
      if (!force && Date.now() < nextPollAt) return;
      if (inFlight) return;
      inFlight = true;
      const requestController = new AbortController();
      controller = requestController;
      try {
        const request = (async () => {
          const response = await fetch("/api/admin/stock-reviews/snapshot", {
            credentials: "same-origin",
            cache: "no-store",
            signal: requestController.signal,
          });
          if (!response.ok) throw new Error("Stock updates unavailable");
          const value: unknown = await response.json();
          if (!callbacks.current.isValid(value)) throw new Error("Invalid stock snapshot");
          return value;
        })();
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            requestController.abort();
            reject(new Error("Stock update timed out"));
          }, TIMEOUT_MS);
        });
        const value = await Promise.race([request, deadline]);
        if (stopped) return;
        failures = 0;
        nextPollAt = Date.now() + callbacks.current.pollInterval(value);
        deferred = { value };
        setConnectionLost(false);
        if (isVisible()) commitDeferred();
      } catch {
        failures += 1;
        nextPollAt = Date.now() + Math.min(60_000, POLL_MS * 2 ** Math.min(failures, 4));
        if (!stopped) setConnectionLost(true);
      } finally {
        clearTimeout(timeout);
        timeout = undefined;
        controller = null;
        inFlight = false;
        if (!stopped && reloadQueued) {
          reloadQueued = false;
          void poll(true);
        }
      }
    }

    reloadRef.current = () => {
      if (inFlight) reloadQueued = true;
      else void poll(true);
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    const visible = () => { if (isVisible()) void poll(true); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      reloadRef.current = () => {};
      clearInterval(timer);
      clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initial]);

  return { snapshot, connectionLost, reload };
}
