import type { FieldErrors } from "@/lib/forms/action-error";

/** Stable public codes. Callers may add fields; they must not rename these. */
export const PUBLIC_ERROR_CODES = [
  "validation",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "expired",
  "processing",
  "rate_limited",
  "unavailable",
  "unknown",
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/**
 * Backwards-compatible payload. Existing consumers read `error` as a string
 * or a field map. `code`, `retryable`, `retryAfterSeconds`, `supportReference`
 * and `fieldErrors` are additive.
 */
export interface PublicErrorBody {
  error: string | FieldErrors;
  code: PublicErrorCode;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportReference?: string;
  fieldErrors?: FieldErrors;
}

export interface PublicErrorMeta {
  code: PublicErrorCode;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportReference?: string;
}

const RETRYABLE: Record<PublicErrorCode, boolean> = {
  validation: false,
  unauthorized: false,
  forbidden: false,
  not_found: false,
  conflict: false,
  expired: true,
  processing: true,
  rate_limited: true,
  unavailable: true,
  unknown: false,
};

/** Shared default. Upload and payment callers can override with an explicit boolean. */
export function defaultPublicRetryable(code: PublicErrorCode): boolean {
  return RETRYABLE[code];
}

const SUPPORT_REFERENCE = /^[A-Za-z0-9_-]{8,80}$/;

export function isPublicErrorCode(value: unknown): value is PublicErrorCode {
  return typeof value === "string" && PUBLIC_ERROR_CODES.includes(value as PublicErrorCode);
}

/**
 * Syntax guard only: empty text, length, control characters, and URL-like text.
 * This is not a security allowlist. Callers must pass an approved message.
 * Each public boundary keeps its own allowlist; the upload allowlist is
 * `acceptedUploadMessage` in `lib/media/upload-error-catalog.ts`.
 */
export function isRenderablePublicMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 280) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  if (/https?:|www\.|<|\/\//i.test(trimmed)) return false;
  return true;
}

export function publicFallbackMessage(code: PublicErrorCode): string {
  if (code === "validation") {
    return "Something went wrong. Please check your details and try again.";
  }
  if (code === "rate_limited") {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (code === "unavailable") {
    return "Service temporarily unavailable. Please try again shortly.";
  }
  if (code === "unknown") {
    return "We couldn't confirm that this request finished. Check the result before trying again.";
  }
  return "We couldn't complete that request. Check the result before trying again.";
}

export function safeSupportReference(value: unknown): string | undefined {
  return typeof value === "string" && SUPPORT_REFERENCE.test(value) ? value : undefined;
}

export function publicErrorBody(input: {
  message: string;
  code: PublicErrorCode;
  retryable?: boolean;
  retryAfterSeconds?: number;
  supportReference?: string;
  fieldErrors?: FieldErrors;
}): PublicErrorBody {
  const message = isRenderablePublicMessage(input.message)
    ? input.message.trim()
    : publicFallbackMessage(input.code);
  const body: PublicErrorBody = {
    error: message,
    code: input.code,
    retryable: input.retryable ?? RETRYABLE[input.code],
  };
  if (
    typeof input.retryAfterSeconds === "number" &&
    Number.isInteger(input.retryAfterSeconds) &&
    input.retryAfterSeconds >= 1 &&
    input.retryAfterSeconds <= 86_400
  ) {
    body.retryAfterSeconds = input.retryAfterSeconds;
  }
  const reference = safeSupportReference(input.supportReference);
  if (reference) body.supportReference = reference;
  if (input.fieldErrors && Object.keys(input.fieldErrors).length > 0) {
    body.fieldErrors = input.fieldErrors;
  }
  return body;
}

/** Field-map form used by existing action consumers. The string message is optional. */
/** Action results also expose `data` on success, so failures include it as absent. */
export type ActionFailure = PublicErrorBody & { error: string; data?: undefined };

export function asActionFailure(body: PublicErrorBody): ActionFailure {
  const error = typeof body.error === "string" ? body.error : publicFallbackMessage(body.code);
  return { ...body, error, data: undefined };
}

export function publicFieldErrorBody(
  fieldErrors: FieldErrors,
  message?: string,
): PublicErrorBody {
  if (!message) {
    return { error: fieldErrors, code: "validation", retryable: false, fieldErrors };
  }
  return publicErrorBody({ message, code: "validation", fieldErrors });
}

export function readPublicErrorMeta(value: unknown): PublicErrorMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isPublicErrorCode(record.code)) return null;
  const retryAfter = record.retryAfterSeconds;
  return {
    code: record.code,
    retryable: typeof record.retryable === "boolean" ? record.retryable : RETRYABLE[record.code],
    ...(typeof retryAfter === "number" &&
    Number.isInteger(retryAfter) &&
    retryAfter >= 1 &&
    retryAfter <= 86_400
      ? { retryAfterSeconds: retryAfter }
      : {}),
    ...(safeSupportReference(record.supportReference)
      ? { supportReference: record.supportReference as string }
      : {}),
  };
}

const REFERENCE_CODES = new Set<PublicErrorCode>(["unknown", "unavailable", "processing"]);

/**
 * Attaches a monitoring event id when capture succeeds.
 * Capture throwing or returning null leaves the original body unchanged.
 */
/** Monitoring must not replace a known result or the safe unknown body. */
export async function captureWithoutMasking(
  capture: () => Promise<unknown>,
): Promise<void> {
  try {
    await capture();
  } catch {
    return;
  }
}

export async function withMonitoringReference(
  body: PublicErrorBody,
  capture: () => Promise<{ eventId?: string | null } | null>,
): Promise<PublicErrorBody> {
  let captured: { eventId?: string | null } | null = null;
  try {
    captured = await capture();
  } catch {
    return body;
  }
  const reference = safeSupportReference(captured?.eventId);
  if (!reference || typeof body.error !== "string" || !REFERENCE_CODES.has(body.code)) {
    return body;
  }
  if (body.error.includes(reference)) {
    return { ...body, supportReference: reference };
  }
  const message = `${body.error} If it continues, contact support with reference ${reference}.`;
  if (!isRenderablePublicMessage(message)) {
    return { ...body, supportReference: reference };
  }
  return { ...body, error: message, supportReference: reference };
}
