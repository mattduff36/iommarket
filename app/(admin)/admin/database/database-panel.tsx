"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshPreviewMirrorAction } from "@/actions/admin/preview-mirror";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type MirrorStatus = {
  lastSuccessAt: string | null;
  nextAutomaticAt: string | null;
  lastError: string | null;
};

function dateLabel(value: string | null, available: boolean) {
  if (!available) return "Unavailable";
  return value ? new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "Not yet scheduled";
}

export function DatabasePanel({ initialStatus, initialStatusError }: { initialStatus: MirrorStatus | null; initialStatusError?: string }) {
  const router = useRouter();
  const status = initialStatus;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function refresh() {
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await refreshPreviewMirrorAction();
        if ("error" in result) { setError(result.error ?? "Preview refresh failed."); return; }
        if (result.data.status === "busy") { setNotice("A preview refresh is already running. Check back shortly."); return; }
        if (result.data.status === "not-due") { setNotice("The automatic refresh is not due yet. No data was changed."); return; }
        const rows = result.data.copiedRows?.toLocaleString() ?? "all";
        setNotice(`Preview refreshed successfully (${rows} rows copied). Signing out now. Sign in again to continue.`);
        const supabase = createSupabaseBrowserClient();
        try { await supabase.auth.signOut({ scope: "local" }); }
        catch { /* The mirror may already have invalidated this account; continue clearing local state. */ }
        router.replace("/sign-in");
        router.refresh();
      } catch { setError("Preview refresh could not be completed. Reload the page and check its status before retrying."); }
    });
  }

  return (
    <div className="space-y-5" aria-busy={pending}>
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text-primary">Production data mirror</h2>
        <p className="mt-2 text-sm text-text-secondary">Refreshing replaces all preview data, including every account. All users will be signed out and must sign in again. Do not use preview to keep separate accounts or data.</p>
        <Button className="mt-4" type="button" disabled={pending || !status} loading={pending} onClick={refresh}>
          {pending ? "Refreshing preview…" : "Refresh from production"}
        </Button>
      </section>
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="mirror-status">
        <h2 id="mirror-status" className="text-lg font-semibold text-text-primary">Refresh status</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-text-secondary">Last successful refresh</dt><dd className="mt-1 font-medium">{dateLabel(status?.lastSuccessAt ?? null, Boolean(status))}</dd></div>
          <div><dt className="text-text-secondary">Next automatic refresh</dt><dd className="mt-1 font-medium">{dateLabel(status?.nextAutomaticAt ?? null, Boolean(status))}</dd></div>
        </dl>
        {!status ? <p className="mt-3 text-sm text-neon-red-500" role="alert">Refresh status is unavailable{initialStatusError ? `: ${initialStatusError}` : ". Reload this page to try again."} The refresh button is disabled until staging status can be verified.</p> : null}
        {status?.lastError ? <p className="mt-3 text-sm text-neon-red-500" role="status">The last refresh failed. Sensitive source details are hidden.</p> : null}
      </section>
      {error || notice ? <div role={error ? "alert" : "status"} className="rounded-md border border-border bg-surface p-4 text-sm">{error || notice}</div> : null}
    </div>
  );
}
