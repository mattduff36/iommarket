import { CancellationError } from "@/lib/policy/cancellation";
import { OnboardingClaimError } from "@/lib/dealers/onboarding/activate";
import { PurgeUserError } from "@/lib/privacy/purge-user-account";
import { AttachUnmatchedListingError } from "@/lib/payments/attach-unmatched-listing";
import { PaymentReconciliationError } from "@/lib/payments/reconcile-payment";
import { CostInvoiceError } from "@/lib/costs/invoices";
import { ManualCategoryError } from "@/lib/costs/manual-categories";
import { CostLedgerError } from "@/lib/costs/ledger";
import {
  acceptedPublicPattern,
  acceptedPublicSentence,
} from "@/lib/forms/journey-public-error";

const CANCELLATION = new Set<string>([
  "Cancellation requests are not enabled.",
  "No paid dealer subscription found.",
  "This subscription is not eligible to cancel.",
  "Cancellation request not found.",
  "Reconciliation requires the provider subscription to already be cancelled.",
  "Completion requires provider cancellation and an expired paid period.",
  "Cancellation request changed. Refresh and try again.",
]);

const CANCELLATION_TRANSITION =
  /^Cannot move a (REQUESTED|ACKNOWLEDGED|RECONCILED|COMPLETED|REJECTED) request to (REQUESTED|ACKNOWLEDGED|RECONCILED|COMPLETED|REJECTED)\.$/;

const ONBOARDING = new Set<string>([
  "This invitation link is no longer valid.",
  "This invitation is no longer valid.",
  "This invitation is already being completed. Wait a moment and try again.",
  "This invitation has expired. Ask iTrader to send a new one.",
  "That email address is already used by another account.",
  "This dealer already has a paid subscription.",
  "Complimentary Pro access has ended.",
  "This dealer has conflicting complimentary access. Contact iTrader support.",
  "This dealer account can no longer be claimed.",
  "This dealer's complimentary access changed during activation. Try again.",
  "This invitation changed during activation. Try again.",
  "Unable to finish dealer onboarding.",
  "Unable to confirm the dealer email address.",
]);

const PURGE = new Set<string>([
  "Account deletion needs a database update.",
  "This account is still referenced by other admin records and cannot be deleted.",
  "Account deletion requires a database update. No login or profile has been removed.",
  "The login could not be removed, so the account was left unchanged.",
  "Managed media needs a complete ownership record before this account can be purged.",
  "Managed media identity is missing.",
]);

const ATTACH = new Set<string>([
  "Direct webhook attachment is disabled. Use the payment reconciliation queue with the matching persisted checkout attempt.",
]);

const INVOICE = new Set<string>([
  "An invoice request is already pending.",
  "There is no invoiceable balance to request.",
  "Invoice request was not found.",
  "Only a pending request can be confirmed.",
  "Invoice request could not be confirmed.",
]);

const LEDGER = new Set<string>([
  "Choose a cost category.",
  "Cost is before the ledger launch boundary.",
]);

const CATEGORY = new Set<string>([
  "Enter a category name with letters or numbers.",
  "Choose a different category name.",
  "Enter a category name between 2 and 40 characters.",
  "Use letters, numbers, and simple punctuation.",
  "That category already exists.",
]);

export function cancellationPublicMessage(error: unknown): string | null {
  if (!(error instanceof CancellationError)) return null;
  return (
    acceptedPublicSentence(error.message, CANCELLATION) ??
    acceptedPublicPattern(error.message, CANCELLATION_TRANSITION)
  );
}

export function onboardingPublicMessage(error: unknown): string | null {
  if (!(error instanceof OnboardingClaimError)) return null;
  return acceptedPublicSentence(error.message, ONBOARDING);
}

export function purgePublicMessage(error: unknown): string | null {
  if (!(error instanceof PurgeUserError)) return null;
  if (error.message.trim() === "User not found") {
    return "This account isn't available for deletion.";
  }
  return acceptedPublicSentence(error.message, PURGE);
}

const RECONCILIATION = new Set<string>([
  "Dealer subscriptions require subscription reconciliation",
  "Invalid Ripple payment reference",
  "Invalid provider payment timestamp",
  "Reconciliation evidence is required",
  "Complete provider attestation is required",
  "Checkout attempt was not found",
  "Provider payment predates the checkout attempt",
  "Checkout attempt does not match the stored payment contract",
  "Manual reconciliation is currently limited to Featured upgrades",
  "Verified webhook does not match the checkout contract",
  "Invalid signed merchant reference",
  "This checkout was already reconciled with different evidence",
  "Payment is no longer eligible for reconciliation",
  "Adverse provider evidence blocks reconciliation",
  "Ripple payment reference is already claimed",
  "Payment changed while reconciliation was in progress",
  "Payment reconciliation could not obtain a unique provider claim",
]);

export function attachUnmatchedPublicMessage(error: unknown): string | null {
  if (!(error instanceof AttachUnmatchedListingError)) return null;
  return acceptedPublicSentence(error.message, ATTACH);
}

export function reconciliationPublicMessage(error: unknown): string | null {
  if (!(error instanceof PaymentReconciliationError)) return null;
  return acceptedPublicSentence(error.message, RECONCILIATION);
}

export function costInvoicePublicMessage(error: unknown): string | null {
  if (!(error instanceof CostInvoiceError)) return null;
  return acceptedPublicSentence(error.message, INVOICE);
}

export function manualCategoryPublicMessage(error: unknown): string | null {
  if (!(error instanceof ManualCategoryError)) return null;
  return acceptedPublicSentence(error.message, CATEGORY);
}

export function costLedgerPublicMessage(error: unknown): string | null {
  if (!(error instanceof CostLedgerError)) return null;
  return acceptedPublicSentence(error.message, LEDGER);
}

export const COST_SETTINGS_UNAVAILABLE =
  "Project cost settings are unavailable. Check the cost pages before trying again.";
