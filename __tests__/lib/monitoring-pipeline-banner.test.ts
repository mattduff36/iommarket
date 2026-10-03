import { describe, expect, it } from "vitest";
import { monitoringPipelineBanner } from "@/lib/monitoring/pipeline-banner";

describe("monitoring pipeline banner", () => {
  it("explains unresolved alert failures instead of a generic warning", () => {
    expect(monitoringPipelineBanner({
      captureEnabled: true,
      consecutiveCaptureFailures: 0,
      consecutiveAlertFailures: 0,
      unresolvedFailedAlerts: 5,
      latestAlertError: "The `\\n` is not allowed in the `subject` field.",
    })).toBe(
      "5 alert emails have failed. Latest error: The `\\n` is not allowed in the `subject` field.",
    );
  });

  it("stays quiet when capture is enabled and nothing has failed", () => {
    expect(monitoringPipelineBanner({
      captureEnabled: true,
      consecutiveCaptureFailures: 0,
      consecutiveAlertFailures: 0,
      unresolvedFailedAlerts: 0,
    })).toBeNull();
  });
});
