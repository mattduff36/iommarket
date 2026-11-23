"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DesktopEnvironment } from "@/lib/dealer-stock-sync/desktop-config";

type PairingAvailability = "checking" | "available" | "offline" | "disabled" | "unknown";
export type OracleConnectionState = "linked" | "unlinked" | "offline" | "checking" | "unknown";

export function useOracleAvailability(needed: boolean): PairingAvailability {
  const [status, setStatus] = useState<PairingAvailability>("checking");
  useEffect(() => {
    if (!needed) { setStatus("checking"); return; }
    let active = true;
    let inFlight = false;
    async function read() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const { getOraclePairingState } = await import("./oracle-pairing-actions");
        const result = await getOraclePairingState();
        if (active) setStatus(result.status);
      } catch {
        if (active) setStatus("unknown");
      } finally { inFlight = false; }
    }
    void read();
    const timer = window.setInterval(() => void read(), 15_000);
    document.addEventListener("visibilitychange", read);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [needed]);
  return status;
}

export function OracleWorkerConnection({ state, environment, openWindows, pending, windowsOnline, launchFeedback }: {
  state: Exclude<OracleConnectionState, "linked">;
  environment: DesktopEnvironment;
  openWindows: () => Promise<void>;
  pending: boolean;
  windowsOnline: boolean;
  launchFeedback: ReactNode;
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const needsLink = state === "unlinked";
  const unavailable = state === "offline";
  async function link() {
    if (lock.current) return;
    lock.current = true;
    setLinking(true);
    setError("");
    try {
      const { requestOraclePairing } = await import("./oracle-pairing-actions");
      const result = await requestOraclePairing();
      if ("code" in result) {
        router.push(`/admin/stock-reviews?pair=oracle&code=${encodeURIComponent(result.code)}`);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the pairing service. Try linking again.");
    } finally { lock.current = false; setLinking(false); }
  }
  const title = needsLink ? "Link the Oracle VM to start scanning" : unavailable ? "Oracle VM is unavailable" :
    state === "checking" ? "Checking Oracle VM connection…" : "Oracle connection status unavailable";
  return <section aria-label="Worker connection" className={`space-y-3 rounded-xl border border-border border-l-[3px] bg-surface-elevated p-4 ${needsLink ? "border-l-amber-400" : "border-l-border"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {(needsLink || unavailable) && <span className={`rounded-full border px-3 py-1 text-xs font-medium ${needsLink ? "border-amber-500/50 bg-amber-500/10 text-amber-300" : "border-border text-text-secondary"}`}>{needsLink ? "Action required" : "Unavailable"}</span>}
    </div>
    {needsLink && <>
      <p className="text-sm text-text-secondary">Dealer scans and approved stock updates are paused for your account until you link the worker. You can still review existing results.</p>
      <button type="button" disabled={linking} onClick={() => void link()} className="min-h-11 rounded-md bg-neon-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{linking ? "Requesting invitation…" : "Link Oracle VM now"}</button>
      {error && <p role="alert" className="text-sm text-text-error">{error}</p>}
    </>}
    {unavailable && <>
      <p className="text-sm text-text-secondary">{windowsOnline ? "The Windows Stock Update app is connected and ready to run stock updates." : "The hosted worker cannot be reached. Use the installed Windows app to run stock updates while the VM is offline."}</p>
      <button type="button" disabled={pending} onClick={() => void openWindows()} className="min-h-11 rounded-md bg-neon-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Open Windows Stock Update</button>
      {launchFeedback}
    </>}
    {state === "unknown" && <p role="status" className="text-sm text-text-secondary">Retrying automatically. You can still review existing results.</p>}
    <p className="text-xs text-text-secondary">{environment === "production" ? "Production — itrader.im" : "Preview — itrader.dev"}</p>
  </section>;
}
