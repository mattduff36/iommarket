import {
  defaultPublicRetryable,
  isPublicErrorCode,
  readPublicErrorMeta,
  type PublicErrorCode,
} from "@/lib/forms/public-error";
import {
  acceptedUploadMessage,
  PHOTO_NETWORK_MESSAGE,
  PHOTO_UNKNOWN_MESSAGE,
  uploadMessageCode,
} from "@/lib/media/upload-error-catalog";

export class UploadClientError extends Error {
  readonly code: PublicErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly supportReference?: string;

  constructor(
    message: string,
    details: {
      code: PublicErrorCode;
      retryable?: boolean;
      retryAfterSeconds?: number;
      supportReference?: string;
    },
  ) {
    super(message);
    this.name = "UploadClientError";
    this.code = details.code;
    this.retryable = details.retryable ?? defaultPublicRetryable(details.code);
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.supportReference = details.supportReference;
  }
}

export function isNetworkUploadFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof UploadClientError) return false;
  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /failed to fetch|networkerror|aborted|timeout/i.test(error.message)
  );
}

export function uploadErrorFromPayload(payload: unknown, fallback: string): UploadClientError {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  const raw = typeof record.error === "string" ? record.error : "";
  const accepted = acceptedUploadMessage(raw);
  if (!accepted) {
    return new UploadClientError(fallback, { code: "unknown", retryable: false });
  }
  const catalogCode = uploadMessageCode(raw) ?? uploadMessageCode(accepted) ?? "unknown";
  const code = isPublicErrorCode(record.code) && record.code === catalogCode ? record.code : catalogCode;
  const meta = readPublicErrorMeta({ ...record, code, error: accepted });
  return new UploadClientError(accepted, {
    code: meta?.code ?? code,
    retryable: meta?.retryable ?? false,
    retryAfterSeconds: meta?.retryAfterSeconds,
    supportReference: meta?.supportReference,
  });
}

export function presentClientUploadError(error: unknown): string {
  if (error instanceof UploadClientError) return formatUploadClientError(error);
  if (isNetworkUploadFailure(error)) return PHOTO_NETWORK_MESSAGE;
  if (error instanceof Error) {
    const accepted = acceptedUploadMessage(error.message);
    if (accepted) return accepted;
  }
  return PHOTO_UNKNOWN_MESSAGE;
}

export function normalizeUploadClientError(error: unknown, fallback = PHOTO_UNKNOWN_MESSAGE): UploadClientError {
  if (error instanceof UploadClientError) return error;
  if (isNetworkUploadFailure(error)) {
    return new UploadClientError(PHOTO_NETWORK_MESSAGE, { code: "unavailable", retryable: true });
  }
  if (error instanceof Error) {
    const accepted = acceptedUploadMessage(error.message);
    if (accepted) {
      const code = uploadMessageCode(accepted) ?? "unknown";
      return new UploadClientError(accepted, { code, retryable: defaultPublicRetryable(code) });
    }
  }
  return new UploadClientError(fallback, { code: "unknown", retryable: false });
}

function formatUploadClientError(error: UploadClientError): string {
  let message = error.message;
  if (
    error.code === "rate_limited" &&
    error.retryAfterSeconds &&
    !message.includes(String(error.retryAfterSeconds))
  ) {
    message = `${message} Wait ${error.retryAfterSeconds} seconds, then try again.`;
  }
  if (error.supportReference && !message.includes(error.supportReference)) {
    message = `${message} If it continues, contact support with reference ${error.supportReference}.`;
  }
  return message;
}
