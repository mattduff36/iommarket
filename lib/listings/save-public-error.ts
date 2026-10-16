import { captureException } from "@/lib/monitoring";
import {
  asActionFailure,
  publicErrorBody,
  withMonitoringReference,
  type ActionFailure,
} from "@/lib/forms/public-error";
import {
  isListingConflictError,
  isListingLifecycleDomainError,
} from "@/lib/listings/errors";
import { LISTING_DECLARATION_ERROR, WRITE_OFF_SUBMIT_ERROR } from "@/lib/listings/write-off-category";
import { requireAcceptedAuth } from "@/lib/policy/gate";

export const LISTING_SAVE_UNKNOWN =
  "We couldn't confirm that your changes were saved. Check the listing before retrying.";
export const LISTING_SUBMIT_UNKNOWN =
  "We couldn't confirm whether this listing was submitted. Check the listing before trying again.";
export const LISTING_PHOTO_UNKNOWN =
  "We couldn't confirm that these photos were saved. Reload the listing before trying again.";
export const LISTING_UNAVAILABLE =
  "This listing isn't available for that action.";
export const LISTING_SIGN_IN = "Sign in again to save this listing.";
export const LISTING_POLICY =
  "Accept the required account policy before saving this listing.";
export const LISTING_FORBIDDEN = "You don't have permission to save this listing.";
export const LISTING_AUTH_CHECK =
  "We couldn't verify your account just now. Check the listing before trying again.";
export const LISTING_ACCOUNT_CLOSED =
  "This account is closed. Sign in with an active account before saving a listing.";
export const LISTING_NAME_REQUIRED =
  "Add your name in account settings before saving a listing.";

const DOMAIN_MESSAGES = new Set<string>([
  "Payment is required to renew an expired listing.",
  "This listing changed before it could be submitted. Please refresh and try again.",
  "A payment was received for this listing. Please refresh and try again.",
  "At least 2 photos are required",
  LISTING_DECLARATION_ERROR,
  WRITE_OFF_SUBMIT_ERROR,
  "No draft changes to submit.",
  "This revision is awaiting review and cannot be edited.",
  "This listing has expired and cannot be edited.",
  "Revisions can only be created for live listings.",
  "Only live listings can submit changes for review.",
  "This listing has expired. Renew it before resubmitting.",
  "These photos were updated elsewhere. Reload and try again.",
]);

const HIDDEN_DOMAIN = new Set<string>([
  "Listing not found",
  "Not authorized for this listing action.",
  "Revision not found",
]);

export type ListingActor =
  Awaited<ReturnType<typeof requireAcceptedAuth>>;

type CaptureContext = {
  action: string;
  route: string;
  requestPath?: string;
  userId?: string;
  userEmail?: string;
  tags?: Record<string, string>;
  fallbackMessage?: string;
};

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

export function listingAuthBody(error: unknown): ActionFailure | null {
  const kind = authKind(error);
  if (kind === "unauthorized") {
    return asActionFailure(publicErrorBody({ message: LISTING_SIGN_IN, code: "unauthorized", retryable: false }));
  }
  if (kind === "policy") {
    return asActionFailure(publicErrorBody({ message: LISTING_POLICY, code: "forbidden", retryable: false }));
  }
  if (kind === "forbidden") {
    return asActionFailure(publicErrorBody({ message: LISTING_FORBIDDEN, code: "forbidden", retryable: false }));
  }
  if (kind === "unavailable") {
    return asActionFailure(publicErrorBody({ message: LISTING_AUTH_CHECK, code: "unavailable", retryable: true }));
  }
  if (kind === "deleted") {
    return asActionFailure(publicErrorBody({ message: LISTING_ACCOUNT_CLOSED, code: "forbidden", retryable: false }));
  }
  if (kind === "profile-name") {
    return asActionFailure(publicErrorBody({ message: LISTING_NAME_REQUIRED, code: "validation", retryable: true }));
  }
  return null;
}

/** Trusted lifecycle copy only. Anything else must use the uncertain save/submit body. */
export function listingDomainResult(
  error: unknown,
  conflictMessage: string,
): { error: string; conflict?: true; data?: undefined } | null {
  if (isListingConflictError(error)) {
    return { error: conflictMessage, conflict: true };
  }
  if (!isListingLifecycleDomainError(error)) return null;
  const message = error.message.trim();
  if (HIDDEN_DOMAIN.has(message)) return { error: LISTING_UNAVAILABLE };
  if (DOMAIN_MESSAGES.has(message)) return { error: message };
  return null;
}

export async function listingUnknownResult(
  error: unknown,
  context: CaptureContext,
  message: string,
): Promise<ActionFailure> {
  return asActionFailure(await withMonitoringReference(
    publicErrorBody({ message, code: "unknown", retryable: false }),
    () => captureException({
      source: "SERVER",
      error,
      action: context.action,
      route: context.route,
      requestPath: context.requestPath ?? context.route,
      userId: context.userId,
      userEmail: context.userEmail,
      tags: context.tags,
    }),
  ));
}

export async function requireListingActor(
  context: CaptureContext,
): Promise<{ user: ListingActor } | { body: ActionFailure }> {
  try {
    return { user: await requireAcceptedAuth() };
  } catch (error) {
    const specific = listingAuthBody(error);
    if (specific && specific.code !== "unavailable") return { body: specific };
    const body = specific ?? asActionFailure(publicErrorBody({
      message: context.fallbackMessage ?? LISTING_AUTH_CHECK,
      code: "unknown",
      retryable: false,
    }));
    return {
      body: asActionFailure(await withMonitoringReference(body, () => captureException({
        source: "SERVER",
        error,
        action: context.action,
        route: context.route,
        requestPath: context.requestPath ?? context.route,
        userId: context.userId,
        userEmail: context.userEmail,
        tags: context.tags,
      }))),
    };
  }
}
