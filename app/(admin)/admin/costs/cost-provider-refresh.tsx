"use client";

import { useEffect, useRef, useState } from "react";
import { refreshProviderCosts } from "@/actions/admin/costs";
import { BrandedSpinner } from "@/components/ui/branded-spinner";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COST_REFRESH_HELP } from "@/lib/costs/copy";
import type { CostSyncHealthDto } from "@/lib/costs/dto";
import { useRefreshPage } from "./use-refresh-page";

const AUTO_REFRESH_LIMIT = 4;

type Phase = "refreshing" | "updated" | "failed" | "idle";

function completedLabel(completedAt: string | null): string | null {
  if (!completedAt) return null;
  return new Date(completedAt).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

export function CostProviderRefresh({
  isOwner,
  sync,
  accountsPreview = false,
}: {
  isOwner: boolean;
  sync: CostSyncHealthDto;
  accountsPreview?: boolean;
}) {
  const refreshPage = useRefreshPage();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>(isOwner ? "refreshing" : "idle");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (accountsPreview || !isOwner || started.current) return;
    started.current = true;
    void (async () => {
      for (let attempt = 0; attempt < AUTO_REFRESH_LIMIT; attempt += 1) {
        const result = await refreshProviderCosts();
        const status = result?.data?.status;
        const moreWork =
          status === "partial" ||
          (status === "succeeded" && result.data?.caughtUp === false);
        if (moreWork && attempt + 1 < AUTO_REFRESH_LIMIT) {
          setDetail(result.data?.message ?? "Refreshing more provider costs");
          continue;
        }
        if (moreWork) {
          setPhase("updated");
          setDetail(
            "Provider costs were partly refreshed. More history remains for the next refresh.",
          );
          refreshPage();
          return;
        }
        if (status === "succeeded" || status === "skipped") {
          setPhase("updated");
          setDetail(result.data?.message ?? null);
          refreshPage();
          return;
        }
        if (status === "locked") {
          setPhase("updated");
          setDetail("A provider refresh is already running. Reload later for the latest total.");
          return;
        }
        setPhase("failed");
        setDetail(result?.error || result?.data?.message || "Provider refresh failed.");
        return;
      }
    })();
  }, [isOwner, refreshPage, accountsPreview]);

  const completed = completedLabel(sync.completedAt);
  if(accountsPreview)return <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-text-secondary">Last updated</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-sm text-text-secondary">{completed?`${completed}.`:"No source update recorded."}</p>{sync.stale?<p className="text-sm text-text-secondary">The source may be out of date.</p>:null}{sync.quarantinedCount>0?<p className="text-sm text-text-secondary">{sync.quarantinedCount} source rows remain under review.</p>:null}</CardContent></Card>;
  let body = completed
    ? `Last completed ${completed}.`
    : "No provider refresh recorded yet.";
  if (isOwner && phase === "refreshing") {
    body = detail === "Refresh already in progress"
      ? "Refresh already in progress"
      : "Refreshing provider costs";
  } else if (isOwner && phase === "updated") {
    body = detail || (completed ? `Provider costs updated ${completed}.` : "Provider costs updated.");
  } else if (isOwner && phase === "failed") {
    body = `${detail ?? "Provider refresh failed."} ${COST_REFRESH_HELP}`;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-text-secondary">Provider costs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isOwner && phase === "refreshing" ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <BrandedSpinner size="sm" />
            <span>{body}</span>
          </p>
        ) : (
          <p className="text-sm text-text-secondary">{body}</p>
        )}
        {sync.quarantinedCount > 0 && phase !== "refreshing" ? (
          <p className="text-sm text-text-secondary">
            {sync.quarantinedCount} provider rows could not be classified.
          </p>
        ) : null}
        {isOwner ? (
          <AdminActionButton
            type="button"
            disabled={phase === "refreshing"}
            onClick={() => {
              setPhase("refreshing");
              setDetail(null);
              void (async () => {
                const result = await refreshProviderCosts();
                if (result?.error) {
                  setDetail(typeof result.error === "string" ? result.error : "Provider refresh failed.");
                  setPhase("failed");
                  return;
                }
                setDetail(result?.data?.message ?? "Provider costs updated.");
                setPhase(result?.data?.status === "failed" ? "failed" : "updated");
                refreshPage();
              })();
            }}
          >
            Refresh provider costs
          </AdminActionButton>
        ) : null}
      </CardContent>
    </Card>
  );
}
