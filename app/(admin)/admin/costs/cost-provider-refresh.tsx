"use client";

import { useEffect, useRef, useState } from "react";
import { refreshProviderCosts } from "@/actions/admin/costs";
import { BrandedSpinner } from "@/components/ui/branded-spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COST_REFRESH_HELP } from "@/lib/costs/copy";
import type { CostSyncHealthDto } from "@/lib/costs/dto";
import { useRefreshPage } from "./use-refresh-page";

const POLL_LIMIT = 8;
const POLL_MS = 4000;

type Phase = "refreshing" | "updated" | "failed" | "idle";

function completedLabel(completedAt: string | null): string | null {
  if (!completedAt) return null;
  return new Date(completedAt).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

export function CostProviderRefresh({
  isOwner,
  sync,
}: {
  isOwner: boolean;
  sync: CostSyncHealthDto;
}) {
  const refreshPage = useRefreshPage();
  const refreshRef = useRef(refreshPage);
  refreshRef.current = refreshPage;
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>(isOwner ? "refreshing" : "idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!isOwner || started.current) return;
    started.current = true;
    void (async () => {
      const result = await refreshProviderCosts();
      const status = result?.data?.status;
      if (status === "succeeded" || status === "skipped") {
        setPhase("updated");
        setDetail(result.data?.message ?? null);
        refreshRef.current();
        return;
      }
      if (status === "locked") {
        setPhase("refreshing");
        setDetail("Refresh already in progress");
        setPolling(true);
        return;
      }
      setPhase("failed");
      setDetail(result?.error || result?.data?.message || "Provider refresh failed.");
    })();
  }, [isOwner]);

  useEffect(() => {
    if (!polling) return;
    if (sync.status === "SUCCEEDED") {
      setPolling(false);
      setPhase("updated");
      return;
    }
    if (sync.status === "FAILED") {
      setPolling(false);
      setPhase("failed");
      setDetail("Provider refresh failed.");
      return;
    }
    if (polls >= POLL_LIMIT) {
      setPolling(false);
      return;
    }
    const timer = setTimeout(() => {
      setPolls((count) => count + 1);
      refreshRef.current();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, polls, sync.status]);

  const completed = completedLabel(sync.completedAt);
  let body = completed
    ? `Last completed ${completed}.`
    : "No provider refresh recorded yet.";
  if (isOwner && phase === "refreshing") {
    body = detail === "Refresh already in progress"
      ? "Refresh already in progress"
      : "Refreshing provider costs";
  } else if (isOwner && phase === "updated") {
    body = completed ? `Provider costs updated ${completed}.` : detail || "Provider costs updated.";
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
      </CardContent>
    </Card>
  );
}
