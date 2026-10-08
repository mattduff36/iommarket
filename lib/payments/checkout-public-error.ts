import { captureException } from "@/lib/monitoring";
import {
  asActionFailure,
  publicErrorBody,
  withMonitoringReference,
  type ActionFailure,
} from "@/lib/forms/public-error";
import { requireAcceptedAuth } from "@/lib/policy/gate";

export const CHECKOUT_OUTCOME_UNKNOWN =
  "We haven't confirmed the payment result yet. Check payment status before paying again.";
export const CHECKOUT_SIGN_IN = "Sign in again to continue checkout.";
export const CHECKOUT_POLICY =
  "Accept the required account policy before continuing checkout.";
export const CHECKOUT_FORBIDDEN = "You don't have permission to continue this checkout.";
export const CHECKOUT_AUTH_CHECK =
  "We couldn't verify your account just now. Check payment status before paying again.";
export const CHECKOUT_ACCOUNT_CLOSED =
  "This account is closed. Sign in with an active account before continuing checkout.";
export const CHECKOUT_NAME_REQUIRED =
  "Add your name in account settings before continuing checkout.";
export const SAMPLE_OUTCOME_UNKNOWN =
  "We haven't confirmed this sample payment. Check the listing before trying a sample card again.";

const CHECKOUT_CODES = new Map<string, string>([
  ["RIPPLE_PREVIEW_CHECKOUT_DISABLED", "New payments are disabled on preview. Existing subscriptions continue to renew."],
  ["RIPPLE_STAGING_LINK_REQUIRED", "New payments are disabled on preview. Existing subscriptions continue to renew."],
  ["RIPPLE_LISTING_PAYMENT_URL", "Listing checkout is not configured yet. Please contact support."],
  ["RIPPLE_LISTING_SUPPORT_URL", "Payments are temporarily unavailable in this environment. Please try again later."],
  ["RIPPLE_DEALER_PRO_URL", "Dealer Pro checkout is not configured yet. Please contact support."],
  ["RIPPLE_DEALER_STARTER_URL", "Dealer Starter checkout is not configured yet. Please contact support."],
  ["RIPPLE_FEATURED_PAYMENT_URL", "Featured upgrade checkout is not configured yet. Please contact support."],
  ["STAGING_CHECKOUT_HANDOFF", "Checkout could not be started. Please try again."],
  ["RIPPLE_LIVE_CHECKOUT_ENABLED", "Card checkout is not enabled yet. Please try again after payments go live."],
]);

const AMOUNT_MISMATCH = /^Ripple [\w.-]+ amount must be \d+ pence$/;

/**
 * Trusted checkout codes are the first token we throw, or an exact amount sentence.
 * A provider or database sentence that merely contains one of those words is not trusted.
 */
const EXACT_CHECKOUT_MESSAGES = new Set<string>([
  "Unable to record Private Seller Terms acceptance. Please try again.",
  "Unable to verify Private Seller Terms acceptance. Please try again.",
]);

export function trustedCheckoutMessage(message: string): string | null {
  const trimmed = message.trim();
  if (EXACT_CHECKOUT_MESSAGES.has(trimmed)) return trimmed;
  if (AMOUNT_MISMATCH.test(trimmed)) {
    return "Checkout pricing does not match the Ripple payment link. Please contact support.";
  }
  const token = trimmed.split(/\s+/)[0] ?? "";
  return CHECKOUT_CODES.get(token) ?? null;
}

type CaptureContext = {
  action: string;
  route: string;
  userId?: string;
  userEmail?: string;
  tags?: Record<string, string>;
  fallbackMessage?: string;
};

export async function checkoutUnknownResult(
  error: unknown,
  context: CaptureContext,
  message = CHECKOUT_OUTCOME_UNKNOWN,
): Promise<ActionFailure> {
  return asActionFailure(await withMonitoringReference(
    publicErrorBody({ message, code: "unknown", retryable: false }),
    () => captureException({
      source: "SERVER",
      error,
      action: context.action,
      route: context.route,
      requestPath: context.route,
      userId: context.userId,
      userEmail: context.userEmail,
      tags: context.tags,
    }),
  ));
}

function authKind(
  error: unknown,
): "unauthorized" | "policy" | "forbidden" | "unavailable" | "deleted" | "profile-name" | null {
  const name = error instanceof Error ? error.name : "";
  if (name === "AuthenticationRequiredError") return "unauthorized";
  if (name === "PolicyAcceptanceRequiredError" || name === "OnboardingIncompleteError") return "policy";
  if (name === "DeletedAccountError") return "deleted";
  if (name === "ProfileNameRequiredError") return "profile-name";
  if (name === "AccountDisabledError" || name === "InsufficientPermissionsError") return "forbidden";
  if (name === "PolicyAcceptanceVerificationError") return "unavailable";
  return null;
}

export function checkoutAuthBody(error: unknown): ActionFailure | null {
  const kind = authKind(error);
  if (kind === "unauthorized") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_SIGN_IN, code: "unauthorized", retryable: false }));
  }
  if (kind === "policy") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_POLICY, code: "forbidden", retryable: false }));
  }
  if (kind === "forbidden") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_FORBIDDEN, code: "forbidden", retryable: false }));
  }
  if (kind === "unavailable") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_AUTH_CHECK, code: "unavailable", retryable: true }));
  }
  if (kind === "deleted") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_ACCOUNT_CLOSED, code: "forbidden", retryable: false }));
  }
  if (kind === "profile-name") {
    return asActionFailure(publicErrorBody({ message: CHECKOUT_NAME_REQUIRED, code: "validation", retryable: true }));
  }
  return null;
}

export async function requireCheckoutActor(
  context: CaptureContext,
): Promise<{ user: Awaited<ReturnType<typeof requireAcceptedAuth>> } | { body: ActionFailure }> {
  try {
    return { user: await requireAcceptedAuth() };
  } catch (error) {
    const specific = checkoutAuthBody(error);
    if (specific && specific.code !== "unavailable") return { body: specific };
    const body = specific ?? asActionFailure(publicErrorBody({
      message: context.fallbackMessage ?? CHECKOUT_OUTCOME_UNKNOWN,
      code: "unknown",
      retryable: false,
    }));
    return {
      body: asActionFailure(await withMonitoringReference(body, () => captureException({
        source: "SERVER",
        error,
        action: context.action,
        route: context.route,
        requestPath: context.route,
        userId: context.userId,
        userEmail: context.userEmail,
        tags: context.tags,
      }))),
    };
  }
}

export const PAYMENT_RETURN_UNCERTAIN = {
  title: "Back from checkout",
  message:
    "This page does not confirm that a payment succeeded, was declined, or was cancelled. Check payment status before paying again.",
} as const;
