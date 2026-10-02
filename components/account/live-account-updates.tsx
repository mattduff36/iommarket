"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { readSamplePaymentStatus } from "@/actions/sample-payments";
import {
  PAYMENT_RETURN_STORAGE_KEY,
  PAYMENT_UPDATE_STORAGE_KEY,
  acknowledgeCheckoutHandoff,
  parsePaymentReturnEvent,
  shouldAcknowledgeCheckoutHandoff,
} from "@/lib/payments/checkout-handoff";

export function shouldWatchAccountPage(pathname: string) {
  return /^\/(account(?:\/listings)?|dealer\/(dashboard|subscribe)|admin(?:\/(users|listings|dealers)(?:\/[^/]+)?)?)\/?$/.test(pathname);
}

/** Five-second launch fallback; visible pages only, one request in flight. */
export function LiveAccountUpdates() {
  const pathname = usePathname();
  const router = useRouter();
  const [waitingPath, setWaitingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldWatchAccountPage(pathname)) return;
    let stopped = false;
    let busy = false;
    let dirty = false;
    let version: string | null = null;
    let timeout: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const scope = pathname.startsWith("/admin") ? "admin" : "account";
    const isVisible = () => document.visibilityState !== "hidden";
    const markDirty = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.closest("form")) dirty = true;
    };
    const poll = async () => {
      if (stopped || busy || !isVisible()) return;
      clearTimeout(timeout);
      busy = true;
      try {
        const response = await fetch(`/api/account-updates?scope=${scope}`, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (stopped) return;
        if (response.status === 401 || response.status === 403) { stopped = true; router.refresh(); return; }
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (stopped || !data || typeof data !== "object" || !("version" in data) || typeof data.version !== "string") return;
        if (version !== null && version !== data.version) {
          if (dirty || document.querySelector('[role="dialog"][data-state="open"]')) {
            setWaitingPath(pathname);
            return;
          }
          router.refresh();
          window.dispatchEvent(new Event("itrader:account-updated"));
          setWaitingPath(null);
        }
        version = data.version;
      } catch {
        // Offline/transient errors keep current content and retry when visible.
      } finally {
        busy = false;
        if (!stopped && isVisible()) timeout = setTimeout(() => { void poll(); }, 5_000);
      }
    };
    const resume = () => { if (isVisible()) void poll(); else clearTimeout(timeout); };
    async function onCheckoutHandoff(storageEvent: StorageEvent) {
      const parsed = storageEvent.key === PAYMENT_RETURN_STORAGE_KEY
        ? parsePaymentReturnEvent(storageEvent.newValue)
        : null;
      if (storageEvent.key !== PAYMENT_RETURN_STORAGE_KEY && storageEvent.key !== PAYMENT_UPDATE_STORAGE_KEY) return;
      router.refresh();
      if (!parsed) return;
      try {
        const sample = parsed.sampleCheckoutId
          ? await readSamplePaymentStatus(parsed.sampleCheckoutId)
          : null;
        const link = parsed.sampleCheckoutId
          ? null
          : await (await import("@/actions/hosted-payment-return")).readHostedCheckoutLink();
        if (shouldAcknowledgeCheckoutHandoff({
          event: parsed,
          sampleStatus: sample?.status,
          link,
        })) {
          acknowledgeCheckoutHandoff(parsed.id);
        }
      } catch {
        // The checkout tab keeps its return fallback when this refresh cannot acknowledge.
      }
    }
    window.addEventListener("storage", onCheckoutHandoff);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("input", markDirty);
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timeout);
      window.removeEventListener("storage", onCheckoutHandoff);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("input", markDirty);
    };
  }, [pathname, router]);
  return waitingPath === pathname && shouldWatchAccountPage(pathname) ? (
    <p role="status" className="border-b border-border bg-surface px-4 py-2 text-center text-sm text-text-secondary">
      Updates are available. Finish your changes, then reopen this page to see them.
    </p>
  ) : null;
}
