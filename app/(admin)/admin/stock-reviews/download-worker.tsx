"use client";
import { useState } from "react";

export function DownloadStockWorker() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stock-worker/update", { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("The installer is unavailable. Please try again shortly.");
      const release = await response.json();
      const url = new URL(release.downloadUrl);
      const production = ["itrader.im", "www.itrader.im"].includes(window.location.hostname);
      const origin = production ? "https://snlqivvogfqesxpbjiei.supabase.co" : "https://syneonzucehwlghqmfbg.supabase.co";
      const channel = production ? "production" : "preview";
      if (url.origin !== origin || !url.pathname.startsWith("/storage/v1/object/sign/stock-update-releases/" + channel + "/") || url.username || url.password || url.hash) throw new Error("The download could not be verified.");
      window.location.assign(url.href);
    } catch {
      setError("The installer is unavailable. Please try again shortly.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <button type="button" onClick={download} disabled={busy} aria-busy={busy} className="inline-flex items-center rounded-lg bg-neon-blue-500 px-4 py-2 font-semibold text-white transition hover:bg-neon-blue-600 disabled:cursor-wait disabled:opacity-60">
      {busy ? "Preparing download…" : "Download / update Stock Worker"}
    </button>
    {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
  </div>;
}
