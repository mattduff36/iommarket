export function monitoringPipelineBanner(input: {
  captureEnabled: boolean;
  consecutiveCaptureFailures: number;
  consecutiveAlertFailures: number;
  unresolvedFailedAlerts: number;
  latestAlertError?: string | null;
  latestCaptureError?: string | null;
}): string | null {
  if (!input.captureEnabled) {
    return "Server capture is disabled by MONITORING_CAPTURE_SERVER.";
  }
  if (input.unresolvedFailedAlerts > 0) {
    const noun = input.unresolvedFailedAlerts === 1 ? "alert email has" : "alert emails have";
    const latest = input.latestAlertError?.trim();
    return latest
      ? `${input.unresolvedFailedAlerts} ${noun} failed. Latest error: ${latest}`
      : `${input.unresolvedFailedAlerts} ${noun} failed and can be retried or cleared.`;
  }
  if (input.consecutiveCaptureFailures > 0) {
    const latest = input.latestCaptureError?.trim();
    return latest
      ? `Event capture has failed ${input.consecutiveCaptureFailures} time(s) in a row. Latest error: ${latest}`
      : `Event capture has failed ${input.consecutiveCaptureFailures} time(s) in a row.`;
  }
  if (input.consecutiveAlertFailures > 0) {
    const latest = input.latestAlertError?.trim();
    return latest
      ? `Alert delivery has failed ${input.consecutiveAlertFailures} time(s) in a row. Latest error: ${latest}`
      : `Alert delivery has failed ${input.consecutiveAlertFailures} time(s) in a row.`;
  }
  return null;
}
