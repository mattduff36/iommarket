import { OnboardingIncompleteError } from "@/lib/dealers/onboarding/access-gate";
import { publicErrorBody, withMonitoringReference, type PublicErrorBody } from "@/lib/forms/public-error";
import { acceptedAuthHttpStatus, PolicyAcceptanceRequiredError } from "@/lib/policy/gate";
import {
  UPLOAD_AUTH_CHECK_MESSAGE,
  UPLOAD_PERMISSION_MESSAGE,
  UPLOAD_POLICY_MESSAGE,
  UPLOAD_SIGN_IN_MESSAGE,
} from "@/lib/media/upload-error-catalog";

/**
 * Maps an auth failure to safe upload copy. HTTP status still comes from
 * `acceptedAuthHttpStatus`; this does not change who is allowed to upload.
 */
export async function uploadAuthErrorBody(
  error: unknown,
  capture: () => Promise<{ eventId?: string | null } | null>,
): Promise<{ status: 401 | 403 | 500; body: PublicErrorBody }> {
  const status = acceptedAuthHttpStatus(error);
  if (status === 401) {
    return {
      status,
      body: publicErrorBody({ message: UPLOAD_SIGN_IN_MESSAGE, code: "unauthorized", retryable: false }),
    };
  }
  if (status === 403) {
    const policy = error instanceof PolicyAcceptanceRequiredError || error instanceof OnboardingIncompleteError;
    return {
      status,
      body: publicErrorBody({
        message: policy ? UPLOAD_POLICY_MESSAGE : UPLOAD_PERMISSION_MESSAGE,
        code: "forbidden",
        retryable: false,
      }),
    };
  }
  const body = await withMonitoringReference(
    publicErrorBody({ message: UPLOAD_AUTH_CHECK_MESSAGE, code: "unavailable", retryable: true }),
    capture,
  );
  return { status, body };
}
