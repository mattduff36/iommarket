import { LISTING_UNAVAILABLE } from "@/lib/listings/save-public-error";
import {
  isListingConflictError,
  isListingLifecycleDomainError,
} from "@/lib/listings/errors";
import { LISTING_DECLARATION_ERROR, WRITE_OFF_SUBMIT_ERROR } from "@/lib/listings/write-off-category";
import { acceptedPublicSentence } from "@/lib/forms/journey-public-error";

const HIDDEN = new Set<string>([
  "Listing not found",
  "Not authorized for this listing action.",
  "Revision not found",
  "This listing is not effectively live.",
  "No pending revision to approve.",
  "No pending revision to reject.",
]);

const ALLOWED = new Set<string>([
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
  "Report does not belong to this listing.",
  "This listing cannot be reinstated live. Return it to draft instead.",
  "Only expired taken-down listings can be renewed.",
  "A reason is required.",
  "A moderation reason is required.",
  "Notes are required when the reason is Other.",
  "The moderation taxonomy version is invalid.",
  "The moderation subreason is invalid.",
  "The moderation subreason is retired and cannot be used for new decisions.",
  "The moderation reason and subreason do not match.",
  "Listing status changed. Refresh and try again.",
  "Listing revision changed. Refresh and try again.",
  "Only expired listings can be renewed",
  "Only live listings can be marked as sold",
]);

/** Known listing lifecycle copy only. Unknown domain text is not returned. */
export function lifecyclePublicMessage(error: unknown): string | null {
  if (!isListingLifecycleDomainError(error) && !isListingConflictError(error)) return null;
  if (!(error instanceof Error)) return null;
  const message = error.message.trim();
  if (message.startsWith("Invalid transition:") || HIDDEN.has(message)) {
    return LISTING_UNAVAILABLE;
  }
  return acceptedPublicSentence(message, ALLOWED);
}
