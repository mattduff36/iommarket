import { classifyUploadError, isExactUploadMessage } from "@/lib/media/upload-error-catalog";

/** Exact server-authored messages. Provider paths, URLs and tokens must stay generic. */
export function isSafeImageVerificationMessage(message: string) {
  return isExactUploadMessage(message);
}

export function publicImageVerificationError(error: unknown) {
  const body = classifyUploadError(error).body;
  return typeof body.error === "string" ? body.error : "We couldn't verify this photo right now. Try again shortly.";
}
