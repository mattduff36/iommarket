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
