import { MonitoringPipelineActions } from "@/components/admin/monitoring-pipeline-actions";
import { isServerCaptureEnabled } from "@/lib/monitoring/flags";
import { monitoringPipelineBanner } from "@/lib/monitoring/pipeline-banner";

interface HealthSummary {
  lastCaptureAt: Date | null;
  lastCaptureFailureAt: Date | null;
  lastCaptureFailure?: string | null;
  consecutiveCaptureFailures: number;
  lastAlertSuccessAt: Date | null;
  lastAlertFailureAt: Date | null;
  lastAlertFailure?: string | null;
  consecutiveAlertFailures: number;
  suppressedAlertCount: number;
  vercelFallbackStatus: string | null;
}

function formatTime(value: Date | null) {
  return value ? value.toLocaleString("en-GB") : "Never";
}

export function MonitoringHealthSummary({
  health,
  openCount,
  criticalCount,
  recentEvents,
  previousEvents,
  recurringCount,
  failedDeliveries,
  unresolvedFailedAlerts,
  failedAlertIds,
  latestAlertError,
}: {
  health: HealthSummary | null;
  openCount: number;
  criticalCount: number;
  recentEvents: number;
  previousEvents: number;
  recurringCount: number;
  failedDeliveries: number;
  unresolvedFailedAlerts: number;
  failedAlertIds: string[];
  latestAlertError: string | null;
}) {
  const captureEnabled = isServerCaptureEnabled();
  const banner = monitoringPipelineBanner({
    captureEnabled,
    consecutiveCaptureFailures: health?.consecutiveCaptureFailures ?? 0,
    consecutiveAlertFailures: health?.consecutiveAlertFailures ?? 0,
    unresolvedFailedAlerts,
    latestAlertError: latestAlertError ?? health?.lastAlertFailure,
    latestCaptureError: health?.lastCaptureFailure,
  });
  const canClear = unresolvedFailedAlerts > 0
    || (health?.consecutiveCaptureFailures ?? 0) > 0
    || (health?.consecutiveAlertFailures ?? 0) > 0;

  return (
    <section aria-label="Monitoring health" className="mb-6 space-y-3">
      {banner ? (
        <div className="rounded-lg border border-text-energy/40 bg-text-energy/10 px-4 py-3 text-sm text-text-primary" role="status">
          <p>{banner}</p>
          <MonitoringPipelineActions
            canRetry={unresolvedFailedAlerts > 0}
            canClear={canClear}
            failedAlertIds={failedAlertIds}
          />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HealthCard label="Open issues" value={openCount} />
        <HealthCard label="Critical active" value={criticalCount} />
        <HealthCard label="Recurring in 24h" value={recurringCount} />
        <HealthCard label="Events in 24h" value={recentEvents} detail={`Previous 24h: ${previousEvents.toLocaleString()}`} />
        <HealthCard
          label="Failed alerts in 24h"
          value={failedDeliveries}
          detail={unresolvedFailedAlerts > failedDeliveries ? `Unresolved: ${unresolvedFailedAlerts}` : undefined}
        />
        <HealthCard label="Suppressed alerts" value={health?.suppressedAlertCount ?? 0} />
      </div>
      <div className="grid gap-3 text-sm text-text-secondary sm:grid-cols-2 xl:grid-cols-4">
        <p>Capture: {captureEnabled ? "enabled" : "disabled"}. Last success {formatTime(health?.lastCaptureAt ?? null)}.</p>
        <p>Capture failures: {health?.consecutiveCaptureFailures ?? 0}. Last {formatTime(health?.lastCaptureFailureAt ?? null)}.</p>
        <p>Alert failures: {health?.consecutiveAlertFailures ?? 0}. Last success {formatTime(health?.lastAlertSuccessAt ?? null)}.</p>
        <p>Suppressed alerts: {health?.suppressedAlertCount ?? 0}. Vercel fallback: {health?.vercelFallbackStatus ?? "unknown"}.</p>
      </div>
    </section>
  );
}

function HealthCard({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-low">
      <p className="text-xs uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value.toLocaleString()}</p>
      {detail ? <p className="mt-1 text-xs text-text-tertiary">{detail}</p> : null}
    </div>
  );
}
