import { z } from "zod";

/** Deliberately excludes URLs, form values, response bodies and persistent device IDs. */
export const AUTH_DIAGNOSTIC_CODES = [
  "invalid_credentials", "email_not_confirmed", "over_request_rate_limit",
  "over_email_send_rate_limit", "user_banned", "unexpected_failure", "other",
] as const;

export const clientDiagnosticsSchema = z.object({
  online: z.boolean().optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  operation: z.enum(["sign-in", "photo-submit", "photo-upload"]).optional(),
  authCode: z.enum(AUTH_DIAGNOSTIC_CODES).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  photoState: z.enum(["uploading", "recovering", "needs-attention", "ready"]).optional(),
  photoCount: z.number().int().min(0).max(100).optional(),
  photoUploading: z.boolean().optional(),
  photoRecovering: z.boolean().optional(),
  photoNeedsAttention: z.boolean().optional(),
  imagePhase: z.enum(["preflight", "intent", "provider-upload", "finalize"]).optional(),
  imageRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,160}$/).optional(),
}).strict();

export type ClientDiagnostics = z.infer<typeof clientDiagnosticsSchema>;

export function photoGuardDiagnostics(state: { uploading: boolean; recovering: boolean; needsAttention: boolean; photoCount: number }): ClientDiagnostics {
  return {
    operation: "photo-submit",
    photoState: state.uploading ? "uploading" : state.recovering ? "recovering" : state.needsAttention ? "needs-attention" : "ready",
    photoUploading: state.uploading, photoRecovering: state.recovering, photoNeedsAttention: state.needsAttention,
    ...(Number.isSafeInteger(state.photoCount) ? { photoCount: Math.max(0, Math.min(100, state.photoCount)) } : {}),
  };
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
