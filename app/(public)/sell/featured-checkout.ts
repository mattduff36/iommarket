import type { PayForListingInput } from "@/lib/validations/payment";

export const FEATURED_AFTER_SUBMIT_MESSAGE =
  "Your listing was submitted for review. Featured was not purchased. You can try again from My listings.";

export function featuredPurchaseFailure(error: unknown) {
  if (typeof error === "string" && error.trim()) {
    return `${FEATURED_AFTER_SUBMIT_MESSAGE} ${error.trim()}`;
  }
  return FEATURED_AFTER_SUBMIT_MESSAGE;
}

export function shouldOfferFeaturedUpsell(params: {
  skipCheckout: boolean;
  alreadyFeatured: boolean;
  listingFeePence: number | undefined;
  featuredUpgradePricePence: number | undefined;
}) {
  return (
    !params.skipCheckout &&
    !params.alreadyFeatured &&
    typeof params.listingFeePence === "number" &&
    typeof params.featuredUpgradePricePence === "number"
  );
}

export function featuredCheckoutTotalPence(params: {
  listingFeePence: number;
  featuredUpgradePricePence: number;
  listingFeeDue: boolean;
  includeFeatured: boolean;
}) {
  const listingPence = params.listingFeeDue ? params.listingFeePence : 0;
  const featuredPence = params.includeFeatured ? params.featuredUpgradePricePence : 0;
  return listingPence + featuredPence;
}

export function buildPayForListingInput(params: {
  listingId: string;
  privateSellerTermsAccepted?: true;
  includeFeatured?: boolean;
  listingFeeDue?: boolean;
}): PayForListingInput {
  return {
    listingId: params.listingId,
    ...(params.privateSellerTermsAccepted
      ? { privateSellerTermsAccepted: true as const }
      : {}),
    ...(params.includeFeatured && params.listingFeeDue
      ? { includeFeatured: true as const }
      : {}),
  };
}

export function shouldStartSeparateFeaturedCheckout(params: {
  includeFeatured?: boolean;
  listingFeeDue?: boolean;
  skipCheckout?: boolean;
  skippedPayment?: boolean;
}) {
  return Boolean(
    params.includeFeatured &&
      !params.listingFeeDue &&
      !params.skipCheckout &&
      params.skippedPayment,
  );
}

export function readListingPaymentResult(data: unknown) {
  if (!data || typeof data !== "object") {
    return {
      skippedPayment: false,
      checkoutUrl: null as string | null,
      listingSubmitted: false,
    };
  }
  const record = data as Record<string, unknown>;
  return {
    skippedPayment: record.skippedPayment === true,
    checkoutUrl: typeof record.checkoutUrl === "string" ? record.checkoutUrl : null,
    listingSubmitted: record.listingSubmitted === true,
  };
}
