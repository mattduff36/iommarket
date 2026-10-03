"use client";

import { useState, useTransition } from "react";
import {
  clearMonitoringPipelineWarning,
  retryFailedMonitoringAlerts,
} from "@/actions/admin/monitoring";
import { AdminActionBar, AdminActionButton } from "@/components/admin/admin-action-controls";

function actionError(error: unknown): string {
  if (typeof error === "string") return error;
  return "The monitoring action failed.";
}

export function MonitoringPipelineActions({
  canRetry,
  canClear,
  failedAlertIds,
}: {
  canRetry: boolean;
  canClear: boolean;
  failedAlertIds: string[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canRetry && !canClear) return null;

  return (
    <div className="mt-3">
      <AdminActionBar label="Monitoring pipeline actions">
        {canRetry ? (
          <AdminActionButton
            tone="primary"
            disabled={isPending}
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                try {
                  const result = await retryFailedMonitoringAlerts();
                  if ("error" in result && result.error) {
                    setMessage(actionError(result.error));
                    return;
                  }
                  setMessage(`Retried ${result.data?.attempted ?? 0} failed alert${result.data?.attempted === 1 ? "" : "s"}.`);
                } catch (error) {
                  setMessage(actionError(error));
                }
              });
            }}
          >
            Retry failed alerts
          </AdminActionButton>
        ) : null}
        {canClear ? (
          <AdminActionButton
            tone="warning"
            disabled={isPending}
            onClick={() => {
              const confirmed = window.confirm(
                failedAlertIds.length > 0
                  ? `Dismiss ${failedAlertIds.length} failed alert${failedAlertIds.length === 1 ? "" : "s"} so they will not be retried, and reset the warning counters? Stored error details will be retained.`
                  : "Reset the monitoring warning counters? Stored error details will be retained.",
              );
              if (!confirmed) return;
              setMessage(null);
              startTransition(async () => {
                try {
                  const result = await clearMonitoringPipelineWarning({ deliveryIds: failedAlertIds });
                  if ("error" in result && result.error) {
                    setMessage(actionError(result.error));
                    return;
                  }
                  setMessage(
                    result.data?.cleared
                      ? `Dismissed ${result.data.cleared} failed alert${result.data.cleared === 1 ? "" : "s"} and reset the warning counters.`
                      : "Pipeline warning counters reset.",
                  );
                } catch (error) {
                  setMessage(actionError(error));
                }
              });
            }}
          >
            Clear warning
          </AdminActionButton>
        ) : null}
      </AdminActionBar>
      {message ? <p className="mt-2 text-xs text-text-secondary">{message}</p> : null}
    </div>
  );
}
