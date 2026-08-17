import {
  createListing,
  syncListingImages,
  submitListingForReview,
  updateListing,
} from "@/actions/listings";
import { payForListing } from "@/actions/payments";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import { defendVehicleCatalogueSelection } from "./create-listing-form.helpers";
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
    return {
      kind: "error",
      error:
        typeof result.error === "string"
          ? result.error
          : "Failed to save images. Please try again.",
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

export type ListingSubmitFieldErrors = Record<string, string[]>;

export function summarizeListingSubmitFieldErrors(
  fieldErrors: ListingSubmitFieldErrors,
  fallback: string,
) {
  for (const messages of Object.values(fieldErrors)) {
    const message = messages.find((candidate) => candidate.trim().length > 0);
    if (message) return message;
  }
  return fallback;
}

export type ListingSubmitNavigation =
  | { kind: "checkout"; href: string }
  | { kind: "success"; href: string }
  | { kind: "demo" }
  | {
      kind: "stay";
      error?: string;
      fieldErrors?: ListingSubmitFieldErrors;
      step?: 1 | 3;
    };

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
  createMutationId: () => string;
  onListingId: (listingId: string) => void;
  onDraftUrl: (href: string) => void;
  onPhotoRevision: (photoRevision: number) => void;
  openCheckout: (url: string) => void;
}): Promise<ListingSubmitNavigation> {
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
      : await createListing(listingPayload);

  if (result.error) {
    releaseSubmitFlight(params.submitFlightRef);
    if (typeof result.error === "string") {
      return { kind: "stay", error: result.error };
    }
    return {
      kind: "stay",
      error: summarizeListingSubmitFieldErrors(
        result.error,
        "Please review the highlighted listing details and try again.",
      ),
      fieldErrors: result.error,
      step: 1,
    };
  }

  if (!result.data) {
    releaseSubmitFlight(params.submitFlightRef);
    return { kind: "stay", error: "Failed to save listing. Please try again." };
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
    if (photoOutcome.kind === "conflict") {
      params.photoRevisionRef.current = photoOutcome.photoRevision;
      params.onPhotoRevision(photoOutcome.photoRevision);
      params.photoMutationRef.current = null;
      releaseSubmitFlight(params.submitFlightRef);
      return { kind: "stay", error: photoOutcome.error };
    }
    if (photoOutcome.kind === "error") {
      releaseSubmitFlight(params.submitFlightRef);
      return { kind: "stay", error: photoOutcome.error };
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

  const payResult = params.skipCheckout
    ? { data: { checkoutUrl: null, skippedPayment: true }, error: undefined }
    : await payForListing({
        listingId,
        privateSellerTermsAccepted: params.mode === "private" ? true : undefined,
      });
  if (payResult.error) {
    releaseSubmitFlight(params.submitFlightRef);
    if (typeof payResult.error === "string") {
      return { kind: "stay", error: payResult.error };
    }
    return {
      kind: "stay",
      error: summarizeListingSubmitFieldErrors(
        payResult.error,
        "Unable to continue to checkout. Please review your details and try again.",
      ),
      fieldErrors: payResult.error,
      step: 3,
    };
  }

  if (payResult.data?.skippedPayment) {
    const reviewResult = await submitListingForReview({
      listingId,
      privateSellerTermsAccepted: params.mode === "private" ? true : undefined,
    });
    if (reviewResult?.error) {
      releaseSubmitFlight(params.submitFlightRef);
      return {
        kind: "stay",
        error:
          typeof reviewResult.error === "string"
            ? reviewResult.error
            : "Failed to submit listing for review.",
      };
    }
  }

  if (payResult.data?.checkoutUrl) {
    params.openCheckout(payResult.data.checkoutUrl);
    if (isRippleDemoCheckoutUrl(payResult.data.checkoutUrl)) {
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
}
