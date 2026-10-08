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
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent xl:grid-cols-3">
        <HealthCard label="Open issues" mobileLabel="Open" value={openCount} accent={openCount > 0 ? "bg-neon-red-500" : "bg-emerald-500"} />
        <HealthCard label="Critical active" mobileLabel="Critical" value={criticalCount} accent={criticalCount > 0 ? "bg-neon-red-500" : "bg-emerald-500"} />
        <HealthCard label="Recurring in 24h" mobileLabel="Recurring 24h" value={recurringCount} accent={recurringCount > 0 ? "bg-premium-gold-500" : "bg-emerald-500"} />
        <HealthCard label="Events in 24h" mobileLabel="Events 24h" value={recentEvents} accent="bg-neon-blue-500" detail={`Previous 24h: ${previousEvents.toLocaleString()}`} />
        <HealthCard
          label="Failed alerts in 24h"
          value={failedDeliveries}
          mobileLabel="Failed alerts 24h"
          accent={failedDeliveries > 0 ? "bg-neon-red-500" : "bg-emerald-500"}
          detail={unresolvedFailedAlerts > failedDeliveries ? `Unresolved: ${unresolvedFailedAlerts}` : undefined}
        />
        <HealthCard label="Suppressed alerts" mobileLabel="Suppressed" value={health?.suppressedAlertCount ?? 0} accent="bg-text-tertiary" />
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

function HealthCard({ label, mobileLabel, value, accent, detail }: { label: string; mobileLabel: string; value: number; accent: string; detail?: string }) {
  return (
    <div className="@container/health relative min-w-0 bg-surface p-2.5 shadow-none sm:rounded-lg sm:border sm:border-border sm:p-4 sm:shadow-low">
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] sm:hidden ${accent}`} />
      <p className="break-words text-[10px] leading-3 text-text-tertiary sm:text-xs sm:leading-4 sm:uppercase sm:tracking-wider">
        <span aria-hidden="true" className="sm:hidden">{mobileLabel}</span>
        <span aria-hidden="true" className="hidden sm:inline">{label}</span>
        <span className="sr-only">{label}</span>
      </p>
      <p className="mt-1 min-w-0 break-words text-[clamp(0.75rem,15cqi,1.5rem)] font-bold leading-tight tabular-nums text-text-primary [overflow-wrap:anywhere] sm:mt-2 sm:leading-8 sm:normal-nums">{value.toLocaleString()}</p>
      {detail ? <p className="mt-1 break-words text-[10px] leading-3 text-text-tertiary sm:text-xs sm:leading-4">{detail}</p> : null}
    </div>
  );
}
