import { db } from "@/lib/db";
import { logMonitoringFallback } from "./fallback-log";

const HEALTH_ID = "singleton";

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown monitoring failure";
  return message.slice(0, 500);
}

export async function recordCaptureSuccess(at = new Date()): Promise<void> {
  try {
    await db.monitoringPipelineHealth.upsert({
      where: { id: HEALTH_ID },
      create: {
        id: HEALTH_ID,
        lastCaptureAt: at,
        consecutiveCaptureFailures: 0,
      },
      update: {
        lastCaptureAt: at,
        consecutiveCaptureFailures: 0,
        lastCaptureFailure: null,
      },
    });
  } catch (error) {
    logMonitoringFallback({
      kind: "health-write-failed",
      message: failureMessage(error),
    });
  }
}

export async function recordCaptureFailure(error: unknown, at = new Date()): Promise<void> {
  try {
    await db.monitoringPipelineHealth.upsert({
      where: { id: HEALTH_ID },
      create: {
        id: HEALTH_ID,
        lastCaptureFailureAt: at,
        lastCaptureFailure: failureMessage(error),
        consecutiveCaptureFailures: 1,
      },
      update: {
        lastCaptureFailureAt: at,
        lastCaptureFailure: failureMessage(error),
        consecutiveCaptureFailures: { increment: 1 },
      },
    });
  } catch (healthError) {
    logMonitoringFallback({
      kind: "capture-and-health-failed",
      message: failureMessage(healthError),
    });
  }
}

export async function recordAlertSuccess(at = new Date()): Promise<void> {
  try {
    await db.monitoringPipelineHealth.upsert({
      where: { id: HEALTH_ID },
      create: { id: HEALTH_ID, lastAlertSuccessAt: at, consecutiveAlertFailures: 0 },
      update: {
        lastAlertSuccessAt: at,
        consecutiveAlertFailures: 0,
        lastAlertFailure: null,
      },
    });
  } catch (error) {
    logMonitoringFallback({ kind: "alert-health-write-failed", message: failureMessage(error) });
  }
}

export async function recordAlertFailure(error: unknown, at = new Date()): Promise<void> {
  try {
    await db.monitoringPipelineHealth.upsert({
      where: { id: HEALTH_ID },
      create: {
        id: HEALTH_ID,
        lastAlertFailureAt: at,
        lastAlertFailure: failureMessage(error),
        consecutiveAlertFailures: 1,
      },
      update: {
        lastAlertFailureAt: at,
        lastAlertFailure: failureMessage(error),
        consecutiveAlertFailures: { increment: 1 },
      },
    });
  } catch (healthError) {
    logMonitoringFallback({ kind: "alert-health-write-failed", message: failureMessage(healthError) });
  }
}

export async function recordAlertSuppression(): Promise<void> {
  try {
    await db.monitoringPipelineHealth.upsert({
      where: { id: HEALTH_ID },
      create: { id: HEALTH_ID, suppressedAlertCount: 1 },
      update: { suppressedAlertCount: { increment: 1 } },
    });
  } catch (error) {
    logMonitoringFallback({ kind: "suppression-counter-failed", message: failureMessage(error) });
  }
}

export async function readMonitoringHealth() {
  try {
    return await db.monitoringPipelineHealth.findUnique({ where: { id: HEALTH_ID } });
  } catch (error) {
    logMonitoringFallback({ kind: "health-read-failed", message: failureMessage(error) });
    return null;
  }
}
