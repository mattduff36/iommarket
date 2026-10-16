import { asActionFailure, publicErrorBody, readPublicErrorMeta, type ActionFailure } from "@/lib/forms/public-error";

/** Browser-safe uncertainty signals. Server mappers stay on the server. */
export const UNCERTAIN_LISTING_MESSAGE =
  "We couldn't confirm that your changes were saved. Check the listing before retrying.";
export const UNCERTAIN_CHECKOUT_MESSAGE =
  "We haven't confirmed the payment result yet. Check payment status before paying again.";
export const UNCERTAIN_SAMPLE_MESSAGE =
  "We haven't confirmed this sample payment. Check the listing before trying a sample card again.";

export type OutcomeReview = {
  href: string;
  label: string;
};

/** Unknown contract results and a missing action result. Known validation stays usable. */
export function isUncertainActionResult(result: unknown): boolean {
  if (result == null) return true;
  const meta = readPublicErrorMeta(result);
  return meta?.code === "unknown" || (meta?.code === "processing" && !meta.retryable);
}

export function listingOutcomeReview(listingId: string | null | undefined): OutcomeReview {
  if (listingId) return { href: `/listings/${listingId}`, label: "Check this listing" };
  return { href: "/account/listings", label: "Check your listings" };
}

export function paymentOutcomeReview(listingId: string | null | undefined): OutcomeReview {
  if (listingId) return { href: `/sell/checkout?listing=${encodeURIComponent(listingId)}`, label: "Check payment status" };
  return { href: "/account/listings", label: "Check payment status" };
}

export function subscriptionOutcomeReview(): OutcomeReview {
  return { href: "/dealer/dashboard", label: "Check subscription status" };
}

export function sampleOutcomeReview(checkoutId: string): OutcomeReview {
  return { href: `/sample-checkout/${checkoutId}`, label: "Reload payment status" };
}

/** A lost action response cannot establish whether a mutation happened. */
export async function guardClientMutation<T>(run: () => Promise<T>): Promise<T | ActionFailure> {
  try {
    const result = await run();
    if (result && typeof result === "object" &&
        (("error" in result && result.error) || ("data" in result && result.data))) return result;
  } catch {
    // The server owns diagnostic capture; transport exceptions are never public copy.
  }
  return asActionFailure(publicErrorBody({ message: UNCERTAIN_CHECKOUT_MESSAGE, code: "unknown", retryable: false }));
}
