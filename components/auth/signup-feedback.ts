import {
  publicAuthErrorMessage,
  type FieldErrors,
} from "@/lib/forms/action-error";

export const SIGNUP_PROVIDER_RETRY_MESSAGE =
  "We could not create your account. Please try again shortly.";

export const SIGNUP_FIELD_RETRY_MESSAGE =
  "We could not create your account. Check the highlighted fields and try again.";

export function signupFailureMessage(
  message: string | null | undefined,
  hasFieldErrors: boolean,
): string | null {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) {
    return hasFieldErrors ? null : SIGNUP_PROVIDER_RETRY_MESSAGE;
  }

  const safe = publicAuthErrorMessage(
    trimmed,
    hasFieldErrors ? SIGNUP_FIELD_RETRY_MESSAGE : SIGNUP_PROVIDER_RETRY_MESSAGE,
    { discloseExistingAccount: true },
  );
  if (!hasFieldErrors && /highlighted fields/i.test(safe)) {
    return SIGNUP_PROVIDER_RETRY_MESSAGE;
  }
  return safe;
}

export function withoutFieldError(
  fieldErrors: FieldErrors,
  field: string,
): FieldErrors {
  if (!fieldErrors[field]) return fieldErrors;
  const next = { ...fieldErrors };
  delete next[field];
  return next;
}
