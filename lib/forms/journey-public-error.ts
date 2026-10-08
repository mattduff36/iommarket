import { captureException } from "@/lib/monitoring";
import {
  asActionFailure,
  isRenderablePublicMessage,
  publicErrorBody,
  withMonitoringReference,
  type ActionFailure,
  type PublicErrorCode,
} from "@/lib/forms/public-error";

export const JOURNEY_UNKNOWN_WRITE =
  "We couldn't confirm that this finished. Check the result before trying again.";
export const JOURNEY_UNKNOWN_DESTRUCTIVE =
  "We couldn't confirm that this change finished. Check the recorded result before trying again.";
export const JOURNEY_READ_FAILURE =
  "We couldn't load this just now. Try again shortly.";
export const TRANSPORT_AMBIGUOUS =
  "We couldn't tell whether that finished. Check your connection, then check the result before trying again.";
export const TRANSPORT_OFFLINE_HINT =
  "Your browser reports that you are offline. We couldn't tell whether that finished. Check the result before trying again.";

export type JourneyKind = "read" | "write" | "destructive";

export function acceptedPublicSentence(
  message: string,
  allow: ReadonlySet<string>,
): string | null {
  const trimmed = message.trim();
  if (!allow.has(trimmed) || !isRenderablePublicMessage(trimmed)) return null;
  return trimmed;
}

export function acceptedPublicPattern(message: string, pattern: RegExp): string | null {
  const trimmed = message.trim();
  if (!pattern.test(trimmed) || !isRenderablePublicMessage(trimmed)) return null;
  return trimmed;
}

export function journeyFallback(kind: JourneyKind): {
  message: string;
  code: PublicErrorCode;
  retryable: boolean;
} {
  if (kind === "read") {
    return { message: JOURNEY_READ_FAILURE, code: "unavailable", retryable: true };
  }
  if (kind === "destructive") {
    return { message: JOURNEY_UNKNOWN_DESTRUCTIVE, code: "unknown", retryable: false };
  }
  return { message: JOURNEY_UNKNOWN_WRITE, code: "unknown", retryable: false };
}

export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /failed to fetch|networkerror|timeout|aborted/i.test(error.message)
  );
}

/** Browser online status is only a hint. A transport failure never claims the write succeeded or failed. */
export function transportPublicMessage(error: unknown, onlineHint?: boolean): string | null {
  if (!isTransportFailure(error)) return null;
  if (onlineHint === false) return TRANSPORT_OFFLINE_HINT;
  return TRANSPORT_AMBIGUOUS;
}

export async function journeyUnknownResult(input: {
  error: unknown;
  journey: string;
  action: string;
  route: string;
  kind: JourneyKind;
  message?: string;
  userId?: string;
  userEmail?: string;
  tags?: Record<string, unknown>;
}): Promise<ActionFailure> {
  const fallback = journeyFallback(input.kind);
  const message =
    input.message && isRenderablePublicMessage(input.message)
      ? input.message.trim()
      : fallback.message;
  const body = publicErrorBody({
    message,
    code: fallback.code,
    retryable: fallback.retryable,
  });
  return asActionFailure(
    await withMonitoringReference(body, () =>
      captureException({
        source: "SERVER",
        error: input.error,
        action: input.action,
        route: input.route,
        requestPath: input.route,
        userId: input.userId,
        userEmail: input.userEmail,
        tags: {
          ...input.tags,
          publicErrorCode: fallback.code,
          journey: input.journey,
          operationKind: input.kind,
        },
      }),
    ),
  );
}
