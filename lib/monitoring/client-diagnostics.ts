/** Deliberately excludes URLs, form values, response bodies and persistent device IDs. */
export const AUTH_DIAGNOSTIC_CODES = [
  "invalid_credentials", "email_not_confirmed", "over_request_rate_limit",
  "over_email_send_rate_limit", "user_banned", "unexpected_failure", "other",
] as const;

export interface ClientDiagnostics {
  online?: boolean;
  visibility?: "visible" | "hidden";
  operation?: "sign-in";
  authCode?: typeof AUTH_DIAGNOSTIC_CODES[number];
  httpStatus?: number;
}

export function browserDiagnostics(): ClientDiagnostics {
  return {
    ...(typeof navigator !== "undefined" ? { online: navigator.onLine } : {}),
    ...(typeof document !== "undefined" && ["visible", "hidden"].includes(document.visibilityState)
      ? { visibility: document.visibilityState as "visible" | "hidden" } : {}),
  };
}

export function signInDiagnostics(error: { code?: string; status?: number }): ClientDiagnostics {
  return {
    operation: "sign-in",
    authCode: AUTH_DIAGNOSTIC_CODES.find(code => code === error.code) ?? "other",
    ...(Number.isInteger(error.status) && error.status! >= 100 && error.status! <= 599
      ? { httpStatus: error.status } : {}),
  };
}
