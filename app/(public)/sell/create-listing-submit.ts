import {
  createListing,
  syncListingImages,
  submitListingForReview,
  updateListing,
} from "@/actions/listings";
import { payForListing, upgradeFeatured } from "@/actions/payments";
import { readPublicActionError, splitActionError, summarizeFieldErrors, type FieldErrors } from "@/lib/forms/action-error";
import {
  isUncertainActionResult,
  listingOutcomeReview,
  paymentOutcomeReview,
  UNCERTAIN_LISTING_MESSAGE,
  UNCERTAIN_CHECKOUT_MESSAGE,
  type OutcomeReview,
} from "@/lib/forms/outcome-uncertainty";
import {
  guidedStepForFieldErrors,
  type GuidedListingStep,
} from "@/lib/listings/guided-listing-workflow";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import { defendVehicleCatalogueSelection } from "./create-listing-form.helpers";
import {
  buildPayForListingInput,
  featuredPurchaseFailure,
  readListingPaymentResult,
  shouldStartSeparateFeaturedCheckout,
} from "./featured-checkout";
import type { VehicleCatalogueSelection } from "./vehicle-catalogue-fields";

export type PhotoMutationPending = {
  basePhotoRevision: number;
  photoSignature: string;
  mutationId: string;
};

export function chooseListingWriteAction(listingId: string | null): "create" | "update" {
  return listingId ? "update" : "create";
}

export function nextPhotoRevisionAfterListingSave(
  data: { version?: number; photoRevision?: number } | null | undefined,
): number | null {
  if (typeof data?.version === "number") {
    return data.version;
  }
  if (typeof data?.photoRevision === "number") {
    return data.photoRevision;
  }
  return null;
}

export function applyAuthoritativePhotoRevision(
  current: number,
  incoming: number | null | undefined,
): number {
  if (typeof incoming === "number" && incoming > current) {
    return incoming;
  }
  return current;
}

export function resolvePhotoMutation(params: {
  pending: PhotoMutationPending | null;
  basePhotoRevision: number;
  photoSignature: string;
  createMutationId: () => string;
}): { mutationId: string; pending: PhotoMutationPending } {
  const mutationId =
    params.pending?.photoSignature === params.photoSignature
      ? params.pending.mutationId
      : params.createMutationId();

  return {
    mutationId,
    pending: {
      basePhotoRevision: params.basePhotoRevision,
      photoSignature: params.photoSignature,
      mutationId,
    },
  };
}

export type PhotoSyncOutcome =
  | { kind: "success"; photoRevision?: number; keepMutation: true }
  | { kind: "conflict"; photoRevision: number; error: string }
  | { kind: "error"; error: string };

export function interpretPhotoSyncResult(result: {
  error?: unknown;
  conflict?: boolean;
  photoRevision?: number;
  data?: { photoRevision?: number };
}): PhotoSyncOutcome {
  if (result.conflict && typeof result.photoRevision === "number") {
    return {
      kind: "conflict",
      photoRevision: result.photoRevision,
      error:
        typeof result.error === "string"
          ? result.error
          : "These photos were updated elsewhere. Reload and try again.",
    };
  }

  if (result.error) {
    const published = readPublicActionError(result);
    const message = published?.formError
      ?? (typeof result.error === "string" ? result.error : "");
    return {
      kind: "error",
      error: message || "We couldn't confirm that these photos were saved. Reload the listing before trying again.",
    };
  }

  return {
    kind: "success",
    photoRevision: result.data?.photoRevision,
    keepMutation: true,
  };
}

export function getDraftEditorNavigationHref(params: {
  listingId: string;
  mode: "private" | "dealer";
}) {
  return getDraftEditorHref({
    listingId: params.listingId,
    dealerId: params.mode === "dealer" ? params.listingId : null,
  });
}

export function getHostedCheckoutHref(params: {
  listingId: string;
  mode: "private" | "dealer";
}) {
  const checkoutSearch = new URLSearchParams({
    listing: params.listingId,
    flow: params.mode,
    opened: "1",
  });
  return `/sell/checkout?${checkoutSearch.toString()}`;
}

export function getListingSuccessHref(params: {
  listingId: string;
  mode: "private" | "dealer";
  skippedPayment: boolean;
}) {
  const search = new URLSearchParams({
    listing: params.listingId,
    flow: params.mode,
    payment: params.skippedPayment ? "skipped" : "paid",
  });
  return `/sell/success?${search.toString()}`;
}

export function tryBeginSubmitFlight(inFlight: { current: boolean }) {
  if (inFlight.current) {
    return false;
  }
  inFlight.current = true;
  return true;
}

export function releaseSubmitFlight(inFlight: { current: boolean }) {
  inFlight.current = false;
}

export function collectListingAttributes(
  definitions: Array<{ id: string }>,
  values: Record<string, string> | FormData,
): Array<{ attributeDefinitionId: string; value: string }> {
  const attributes: Array<{ attributeDefinitionId: string; value: string }> = [];
  for (const definition of definitions) {
    const raw =
      values instanceof FormData
        ? (values.get(`attr-${definition.id}`) as string | null)
        : values[definition.id];
    const value = raw?.trim() ?? "";
    if (value) {
      attributes.push({ attributeDefinitionId: definition.id, value });
    }
  }
  return attributes;
}

export type ListingSubmitFieldErrors = FieldErrors;

export function summarizeListingSubmitFieldErrors(
  fieldErrors: ListingSubmitFieldErrors,
  fallback: string,
) {
  return summarizeFieldErrors(fieldErrors, fallback);
}

export type ListingSubmitNavigation =
  | { kind: "checkout"; href: string }
  | { kind: "success"; href: string }
  | { kind: "demo" }
  | {
      kind: "stay";
      error?: string;
      fieldErrors?: ListingSubmitFieldErrors;
      step?: GuidedListingStep;
      uncertain?: boolean;
      reviewHref?: string;
      reviewLabel?: string;
    };

function stayForListingError(
  result: { error?: unknown },
  attributeSteps: Partial<Record<string, GuidedListingStep>> | undefined,
  fallback: GuidedListingStep,
  review: OutcomeReview,
): ListingSubmitNavigation {
  const published = readPublicActionError(result);
  const split = published ?? splitActionError(
    result.error && typeof result.error === "object" ? result.error : result.error,
  );
  if (Object.keys(split.fieldErrors).length > 0) {
    return {
      kind: "stay",
      error: split.formError ?? summarizeListingSubmitFieldErrors(
        split.fieldErrors,
        "Please review the highlighted listing details and try again.",
      ),
      fieldErrors: split.fieldErrors,
      step: guidedStepForFieldErrors(split.fieldErrors, { attributeSteps, fallback }),
    };
  }
  const uncertain = isUncertainActionResult(result);
  return {
    kind: "stay",
    error: split.formError ?? UNCERTAIN_LISTING_MESSAGE,
    ...(uncertain
      ? { uncertain: true, reviewHref: review.href, reviewLabel: review.label }
      : {}),
  };
}

function releaseUnlessUncertain(
  flight: { current: boolean },
  navigation: ListingSubmitNavigation,
): ListingSubmitNavigation {
  if (navigation.kind !== "stay" || !navigation.uncertain) {
    releaseSubmitFlight(flight);
  }
  return navigation;
}

export async function executeCreateListingSubmit(params: {
  form: FormData;
  attributes: Array<{ attributeDefinitionId: string; value: string }>;
  mode: "private" | "dealer";
  skipCheckout: boolean;
  isEditingDraft: boolean;
  uploadedImages: Array<{
    id?: string;
    uploadIntentId?: string;
    focalX?: number | null;
    focalY?: number | null;
  }>;
  listingIdRef: { current: string | null };
  photoRevisionRef: { current: number };
  photoMutationRef: { current: PhotoMutationPending | null };
  submitFlightRef: { current: boolean };
  vehicleCatalogueSelection: VehicleCatalogueSelection;
  isVehicleCatalogueCategory: boolean;
  selectedCategoryAttributes: Array<{ id: string; slug: string }>;
  attributeSteps?: Partial<Record<string, GuidedListingStep>>;
  createMutationId: () => string;
  includeFeatured?: boolean;
  listingFeeDue?: boolean;
  onListingId: (listingId: string) => void;
  onDraftUrl: (href: string) => void;
  onPhotoRevision: (photoRevision: number) => void;
  openCheckout: (url: string) => boolean | void;
}): Promise<ListingSubmitNavigation> {
  let checkoutStarted = false;
  try {
  const listingPayload = {
    title: params.form.get("title") as string,
    description: params.form.get("description") as string,
    price: Math.round(parseFloat(params.form.get("price") as string) * 100),
    categoryId: params.form.get("categoryId") as string,
    regionId: params.form.get("regionId") as string,
    trustDeclarationAccepted: true,
    attributes: params.attributes,
    vehicleCatalogueSelection: params.isVehicleCatalogueCategory
      ? defendVehicleCatalogueSelection({
          selection: params.vehicleCatalogueSelection,
          definitions: params.selectedCategoryAttributes,
          attributes: params.attributes,
        })
      : undefined,
  };
  const existingListingId = params.listingIdRef.current;
  const result =
    chooseListingWriteAction(existingListingId) === "update" && existingListingId
      ? await updateListing({
          id: existingListingId,
          ...listingPayload,
        })
      : await createListing({
          ...listingPayload,
          flow: params.mode,
        });

  if (result.error) {
    return releaseUnlessUncertain(
      params.submitFlightRef,
      stayForListingError(
        result,
        params.attributeSteps,
        1,
        listingOutcomeReview(existingListingId),
      ),
    );
  }

  if (!result.data) {
    const review = listingOutcomeReview(existingListingId);
    return {
      kind: "stay",
      error: UNCERTAIN_LISTING_MESSAGE,
      uncertain: true,
      reviewHref: review.href,
      reviewLabel: review.label,
    };
  }

  const listingId = existingListingId ?? result.data.id;
  params.listingIdRef.current = listingId;
  params.onListingId(listingId);
  if (!existingListingId) {
    params.onDraftUrl(getDraftEditorNavigationHref({ listingId, mode: params.mode }));
  }

  const savedPhotoRevision = applyAuthoritativePhotoRevision(
    params.photoRevisionRef.current,
    nextPhotoRevisionAfterListingSave(result.data),
  );
  if (savedPhotoRevision !== params.photoRevisionRef.current) {
    params.photoRevisionRef.current = savedPhotoRevision;
    params.onPhotoRevision(savedPhotoRevision);
  }

  if (params.isEditingDraft || params.uploadedImages.length > 0) {
    const photos = params.uploadedImages.map((image) => ({
      imageId: image.id,
      uploadIntentId: image.id ? undefined : image.uploadIntentId,
      focalX: image.focalX,
      focalY: image.focalY,
    }));
    const photoSignature = JSON.stringify(photos);
    const currentPhotoRevision = params.photoRevisionRef.current;
    const resolvedMutation = resolvePhotoMutation({
      pending: params.photoMutationRef.current,
      basePhotoRevision: currentPhotoRevision,
      photoSignature,
      createMutationId: params.createMutationId,
    });
    params.photoMutationRef.current = resolvedMutation.pending;
    const saveResult = await syncListingImages(listingId, {
      photos,
      basePhotoRevision: currentPhotoRevision,
      mutationId: resolvedMutation.mutationId,
    });
    const photoOutcome = interpretPhotoSyncResult(saveResult);
    if (photoOutcome.kind === "conflict" || photoOutcome.kind === "error") {
      if (photoOutcome.kind === "conflict") {
        params.photoRevisionRef.current = photoOutcome.photoRevision;
        params.onPhotoRevision(photoOutcome.photoRevision);
        params.photoMutationRef.current = null;
      }
      const uncertain = photoOutcome.kind === "error" && isUncertainActionResult(saveResult);
      const review = listingOutcomeReview(listingId);
      if (!uncertain) releaseSubmitFlight(params.submitFlightRef);
      return {
        kind: "stay",
        error: photoOutcome.error,
        step: 3,
        ...(uncertain
          ? { uncertain: true, reviewHref: review.href, reviewLabel: review.label }
          : {}),
      };
    }
    const nextRevision = applyAuthoritativePhotoRevision(
      params.photoRevisionRef.current,
      photoOutcome.photoRevision,
    );
    if (nextRevision !== params.photoRevisionRef.current) {
      params.photoRevisionRef.current = nextRevision;
      params.onPhotoRevision(nextRevision);
    }
    if (params.photoMutationRef.current) {
      params.photoMutationRef.current = {
        ...params.photoMutationRef.current,
        basePhotoRevision: params.photoRevisionRef.current,
      };
    }
  }

  checkoutStarted = !params.skipCheckout;
  const payResult = params.skipCheckout
    ? { data: { checkoutUrl: null, skippedPayment: true }, error: undefined }
    : await payForListing(
        buildPayForListingInput({
          listingId,
          privateSellerTermsAccepted: params.mode === "private" ? true : undefined,
          includeFeatured: params.includeFeatured,
          listingFeeDue: params.listingFeeDue,
        }),
      );
  if (payResult.error) {
    return releaseUnlessUncertain(
      params.submitFlightRef,
      stayForListingError(payResult, params.attributeSteps, 5, paymentOutcomeReview(listingId)),
    );
  }

  if (!payResult.data) throw new Error("Missing checkout result");
  const listingSubmitted = readListingPaymentResult(payResult.data).listingSubmitted;
  if (payResult.data?.skippedPayment && !listingSubmitted) {
    const reviewResult = await submitListingForReview({
      listingId,
      privateSellerTermsAccepted: params.mode === "private" ? true : undefined,
    });
    if (reviewResult?.error) {
      return releaseUnlessUncertain(params.submitFlightRef, stayForListingError(reviewResult, params.attributeSteps, 5, listingOutcomeReview(listingId)));
    }
  }

  if (
    shouldStartSeparateFeaturedCheckout({
      includeFeatured: params.includeFeatured,
      listingFeeDue: params.listingFeeDue,
      skipCheckout: params.skipCheckout,
      skippedPayment: Boolean(payResult.data?.skippedPayment),
    })
  ) {
    try {
      const featuredResult = await upgradeFeatured(listingId);
      if (featuredResult.error || !featuredResult.data?.checkoutUrl) {
        const uncertain = isUncertainActionResult(featuredResult) || !featuredResult.error;
        const review = paymentOutcomeReview(listingId);
        if (!uncertain) releaseSubmitFlight(params.submitFlightRef);
        return { kind: "stay", error: featuredPurchaseFailure(featuredResult.error), ...(uncertain ? { uncertain: true, reviewHref: review.href, reviewLabel: review.label } : {}) };
      }
      const opened = params.openCheckout(featuredResult.data.checkoutUrl);
      if (opened === false || isRippleDemoCheckoutUrl(featuredResult.data.checkoutUrl)) {
        releaseSubmitFlight(params.submitFlightRef);
        return { kind: "demo" };
      }
      return {
        kind: "checkout",
        href: getHostedCheckoutHref({ listingId, mode: params.mode }),
      };
    } catch {
      const review = paymentOutcomeReview(listingId);
      return { kind: "stay", error: featuredPurchaseFailure(undefined), uncertain: true, reviewHref: review.href, reviewLabel: review.label };
    }
  }

  if (payResult.data?.checkoutUrl) {
    const opened = params.openCheckout(payResult.data.checkoutUrl);
    if (opened === false || isRippleDemoCheckoutUrl(payResult.data.checkoutUrl)) {
      releaseSubmitFlight(params.submitFlightRef);
      return { kind: "demo" };
    }
    return { kind: "checkout", href: getHostedCheckoutHref({ listingId, mode: params.mode }) };
  }

  return {
    kind: "success",
    href: getListingSuccessHref({
      listingId,
      mode: params.mode,
      skippedPayment: Boolean(payResult.data?.skippedPayment),
    }),
  };
  } catch {
    const review = checkoutStarted ? paymentOutcomeReview(params.listingIdRef.current) : listingOutcomeReview(params.listingIdRef.current);
    return { kind: "stay", uncertain: true, error: checkoutStarted ? UNCERTAIN_CHECKOUT_MESSAGE : UNCERTAIN_LISTING_MESSAGE, reviewHref: review.href, reviewLabel: review.label };
  }
}
