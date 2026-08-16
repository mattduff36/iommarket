import { captureException } from "./capture";
import type { MonitoringContext } from "./types";

const CONTROL_FLOW_DIGESTS = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
];

const EXPECTED_ERROR_NAMES = new Set([
  "AccountDeletionError",
  "CancellationError",
  "ListingLifecycleError",
  "ListingRevisionConflictError",
  "PhotoRevisionConflictError",
  "VehicleLookupError",
  "ZodError",
]);

export function isExpectedControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  return CONTROL_FLOW_DIGESTS.some((prefix) => digest.startsWith(prefix));
}

export function isExpectedHandledOutcome(error: unknown): boolean {
  if (isExpectedControlFlowError(error)) return true;
  return error instanceof Error && EXPECTED_ERROR_NAMES.has(error.name);
}

export async function reportHandledException(
  input: MonitoringContext & { error: unknown; action: string },
): Promise<void> {
  if (isExpectedHandledOutcome(input.error)) return;

  try {
    await captureException({
      source: "SERVER",
      error: input.error,
      action: input.action,
      route: input.route,
      requestPath: input.requestPath ?? input.route,
      component: input.component,
      requestMethod: input.requestMethod,
      requestId: input.requestId,
      userId: input.userId,
      userEmail: input.userEmail,
      tags: {
        ...input.tags,
        handled: true,
      },
      extra: input.extra,
    });
  } catch {
    // Monitoring must never change the original failure path.
  }
}
