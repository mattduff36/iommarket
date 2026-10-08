"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UploadedImage } from "@/components/marketplace/image-upload";
import { GuidedListingRail } from "@/components/listings/guided-listing-rail";
import { getAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { groupWriteOffWithVehicleDetails } from "@/lib/listings/listing-ns-ui";
import {
  attributeStepMap,
  buildOptionalDetailSections,
  focusIdForFieldErrors,
  guidedNavigationBlock,
  guidedStepForFieldErrors,
  MIN_GUIDED_LISTING_PHOTOS,
  optionalSectionForAttribute,
  partitionGuidedAttributeFields,
  splitGuidedAttributeErrors,
  validateAdvertFields,
  type GuidedListingStep,
} from "@/lib/listings/guided-listing-workflow";
import { GuidedListingStepPanels } from "./create-listing-guided-panels";
import { validateListingDetailsStep } from "./create-listing-form.validation";
import {
  collectListingAttributes,
  executeCreateListingSubmit,
  getHostedCheckoutHref,
  releaseSubmitFlight,
  tryBeginSubmitFlight,
} from "./create-listing-submit";
import { shouldOfferFeaturedUpsell } from "./featured-checkout";
import { runVehicleLookup } from "./create-listing-form.lookup";
import { useListingDemoOutcome } from "./create-listing-form.demo";
import { trackMarketplaceEvent } from "@/lib/analytics/track-client";
import {
  createPhotoMutationId,
  pruneHiddenAttributes,
  REGISTRATION_LOOKUP_CATEGORY_SLUGS,
  toUploadedImage,
} from "./create-listing-form.helpers";
import type { EditableDraft } from "@/lib/listings/editable-draft";
import { getListingPhotoLimit } from "@/lib/listings/photo-limits";
import { formatRegistrationForDisplay } from "@/lib/utils/registration";
import type { VehicleMakeOption } from "@/lib/vehicle-catalogue/queries";
import type { VehicleCatalogueSelection } from "./vehicle-catalogue-fields";

interface AttributeDef {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  attributes: AttributeDef[];
}

interface RegionOption {
  id: string;
  name: string;
}

interface Props {
  categories: CategoryOption[];
  regions: RegionOption[];
  vehicleMakes?: VehicleMakeOption[];
  mode?: "private" | "dealer";
  isFreeForUser?: boolean;
  initialDraft?: EditableDraft | null;
  enforceListingNs?: boolean;
  listingFeePence?: number;
  featuredUpgradePricePence?: number;
}

export function CreateListingForm({
  categories,
  regions,
  vehicleMakes = [],
  mode = "private",
  isFreeForUser = false,
  initialDraft = null,
  enforceListingNs = false,
  listingFeePence,
  featuredUpgradePricePence,
}: Props) {
  const router = useRouter();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const formRef = useRef<HTMLFormElement>(null);
  const photoMutationRef = useRef<{
    basePhotoRevision: number;
    photoSignature: string;
    mutationId: string;
  } | null>(null);
  const listingIdRef = useRef<string | null>(initialDraft?.id ?? null);
  const photoRevisionRef = useRef(initialDraft?.photoRevision ?? 0);
  const submitFlightRef = useRef(false);
  const isEditingDraft = Boolean(initialDraft);
  const editMode = initialDraft?.editMode ?? (isEditingDraft ? "draft" : undefined);
  const skipCheckout = editMode === "revision" || editMode === "resubmit";
  const listingFeeDue = mode === "private" && !isFreeForUser;
  const showFeaturedOffer = shouldOfferFeaturedUpsell({
    skipCheckout,
    alreadyFeatured: Boolean(initialDraft?.featured),
    listingFeePence,
    featuredUpgradePricePence,
  });
  const revisionLocked = Boolean(initialDraft?.revisionPending);
  const [includeFeatured, setIncludeFeatured] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState<GuidedListingStep>(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialDraft?.categoryId ?? "");
  const [titleValue, setTitleValue] = useState(initialDraft?.title ?? "");
  const [descriptionValue, setDescriptionValue] = useState(initialDraft?.description ?? "");
  const [priceValue, setPriceValue] = useState(
    initialDraft?.price != null ? String(initialDraft.price) : "",
  );
  const [regionId, setRegionId] = useState(initialDraft?.regionId ?? "");
  const [optionalSectionId, setOptionalSectionId] = useState<string | null>(null);
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);
  const [pendingListingId, setPendingListingId] = useState<string | null>(initialDraft?.id ?? null);
  const {
    demoOutcomeError,
    isSimulatingDemoOutcome,
    handleSimulatedDemoOutcome,
    clearDemoOutcomeError,
  } = useListingDemoOutcome({
    pendingListingId,
    mode,
    setDemoDialogOpen,
    replace: (href) => router.replace(href),
    refresh: () => router.refresh(),
  });
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialDraft?.attributes.map((attribute) => [attribute.attributeDefinitionId, attribute.value]) ??
        []
    )
  );
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>(
    () => initialDraft?.images.map(toUploadedImage) ?? [],
  );
  const [photoUploadsBusy, setPhotoUploadsBusy] = useState(false);
  const [, setPhotoRevision] = useState(initialDraft?.photoRevision ?? 0);
  const [trustConfirmed, setTrustConfirmed] = useState(initialDraft?.trustDeclarationAccepted ?? false);
  const [trustConfirmationMissing, setTrustConfirmationMissing] = useState(false);
  const [privateSellerTermsAccepted, setPrivateSellerTermsAccepted] =
    useState(false);
  const [privateSellerTermsMissing, setPrivateSellerTermsMissing] =
    useState(false);
  const [registrationInput, setRegistrationInput] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupMeta, setLookupMeta] = useState<string | null>(null);
  const [vehicleCatalogueSelection, setVehicleCatalogueSelection] =
    useState<VehicleCatalogueSelection>({
      makeMode: "manual",
      modelMode: "manual",
    });
  const maxImages = getListingPhotoLimit({
    isDealer: mode === "dealer",
    isFeatured: Boolean(initialDraft?.featured),
  });

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const isLookupCategorySupported = Boolean(
    selectedCategory &&
      REGISTRATION_LOOKUP_CATEGORY_SLUGS.has(selectedCategory.slug)
  );
  const fuelTypeAttribute = selectedCategory?.attributes.find((attr) => attr.slug === "fuel-type");
  const makeAttribute = selectedCategory?.attributes.find((attr) => attr.slug === "make");
  const modelAttribute = selectedCategory?.attributes.find((attr) => attr.slug === "model");
  const isVehicleCatalogueCategory = Boolean(
    selectedCategory &&
      REGISTRATION_LOOKUP_CATEGORY_SLUGS.has(selectedCategory.slug) &&
      makeAttribute &&
      modelAttribute,
  );
  const selectedFuelType = fuelTypeAttribute
    ? attributeValues[fuelTypeAttribute.id]
    : undefined;
  const attributeValuesBySlug = Object.fromEntries(
    (selectedCategory?.attributes ?? []).map((attribute) => [
      attribute.slug,
      attributeValues[attribute.id]?.trim() ?? "",
    ]),
  );
  const retainedAttributeValues =
    initialDraft && initialDraft.categoryId === selectedCategoryId
      ? initialDraft.attributes
      : [];
  const retainedAttributeValueById = Object.fromEntries(
    retainedAttributeValues.map((attribute) => [
      attribute.attributeDefinitionId,
      attribute.value,
    ]),
  );
  const visibleAttributes = groupWriteOffWithVehicleDetails(
    selectedCategory?.attributes.filter(
      (attr) =>
        !isVehicleCatalogueCategory ||
        (attr.slug !== "make" && attr.slug !== "model"),
    ) ?? [],
  )
    .map((attr) => ({
      attr,
      config: getAttributeFieldConfig(selectedCategory?.slug, attr, selectedFuelType, {
        valuesBySlug: attributeValuesBySlug,
        retainedValue: retainedAttributeValueById[attr.id],
      }),
    }))
    .filter(
      (
        item
      ): item is {
        attr: AttributeDef;
        config: NonNullable<ReturnType<typeof getAttributeFieldConfig>>;
      }       => item.config !== null
    );
  const guidedFields = partitionGuidedAttributeFields(
    selectedCategory?.slug,
    visibleAttributes,
    enforceListingNs,
  );
  const optionalSections = buildOptionalDetailSections(
    selectedCategory?.slug,
    guidedFields.optional,
    (field) => field.attr.slug,
  );
  const activeOptionalSectionId = optionalSections.some((section) => section.id === optionalSectionId)
    ? optionalSectionId
    : (optionalSections[0]?.id ?? null);
  const detailsValidation = validateListingDetailsStep({
    selectedCategoryId,
    selectedCategory,
    attributeValues,
    retainedAttributes: retainedAttributeValues,
    enforceListingNs,
  });
  const attributeErrorSplit = detailsValidation.ok
    ? { required: {}, optional: {} }
    : splitGuidedAttributeErrors(
        detailsValidation.fieldErrors,
        selectedCategory?.attributes ?? [],
        selectedCategory?.slug,
        enforceListingNs,
      );
  const configurationError = detailsValidation.ok
    ? undefined
    : detailsValidation.configurationError;
  const requiredComplete =
    Boolean(selectedCategoryId) &&
    !configurationError &&
    Object.keys(attributeErrorSplit.required).length === 0;
  const optionalValid = Object.keys(attributeErrorSplit.optional).length === 0;
  const photosComplete = uploadedImages.length >= MIN_GUIDED_LISTING_PHOTOS && !photoUploadsBusy;
  const advertValidation = validateAdvertFields({
    title: titleValue,
    description: descriptionValue,
    price: priceValue,
    regionId,
  });
  const advertComplete = advertValidation.ok;
  const attributeSteps = attributeStepMap(
    selectedCategory?.attributes ?? [],
    selectedCategory?.slug,
    enforceListingNs,
  );
  const completion: Record<GuidedListingStep, boolean> = {
    1: requiredComplete,
    2: requiredComplete && optionalValid,
    3: photosComplete,
    4: advertComplete,
    5: false,
  };
  const attention: Record<GuidedListingStep, boolean> = {
    1: false,
    2: false,
    3: false,
    4: false,
    5: false,
  };
  for (const key of Object.keys(fieldErrors)) {
    const errorStep = guidedStepForFieldErrors(
      { [key]: fieldErrors[key] },
      { attributeSteps, fallback: step },
    );
    attention[errorStep] = true;
  }

  useEffect(() => {
    if (!focusFieldId) return;
    const node = document.getElementById(focusFieldId);
    if (!node) return;
    const target = node.matches("button, input, select, textarea")
      ? node
      : node.querySelector<HTMLElement>("button, input, select, textarea");
    target?.focus();
  }, [focusFieldId, step, activeOptionalSectionId]);

  function getFieldError(fieldName: string) {
    return fieldErrors[fieldName]?.[0];
  }

  function handleCategoryChange(categoryId: string) {
    if (categoryId === selectedCategoryId) {
      return;
    }
    setSelectedCategoryId(categoryId);
    setAttributeValues({});
    setFieldErrors({});
    setError(null);
    setLookupError(null);
    setLookupMeta(null);
    setVehicleCatalogueSelection({ makeMode: "manual", modelMode: "manual" });
    setOptionalSectionId(null);
    setFocusFieldId(null);
  }

  function handleAttributeChange(attribute: AttributeDef, value: string) {
    setAttributeValues((currentValues) => {
      const nextValues = { ...currentValues, [attribute.id]: value };
      if (!selectedCategory) {
        return nextValues;
      }

      if (attribute.slug === "make") {
        const modelAttribute = selectedCategory.attributes.find((candidate) => candidate.slug === "model");
        if (modelAttribute) delete nextValues[modelAttribute.id];
      }

      return pruneHiddenAttributes(nextValues, selectedCategory);
    });
  }

  const handleVehicleCatalogueChange = useCallback(
    (attributeId: string, value: string) => {
      const attribute = selectedCategory?.attributes.find(
        (candidate) => candidate.id === attributeId,
      );
      if (!attribute) return;
      setAttributeValues((currentValues) => {
        const nextValues = { ...currentValues, [attribute.id]: value };
        if (attribute.slug === "make") {
          const nextModel = selectedCategory?.attributes.find(
            (candidate) => candidate.slug === "model",
          );
          if (nextModel) delete nextValues[nextModel.id];
        }
        return nextValues;
      });
    },
    [selectedCategory],
  );

  async function handleVehicleLookup() {
    setLookupPending(true);
    setLookupError(null);
    setLookupMeta(null);
    const result = await runVehicleLookup({
      selectedCategory,
      isLookupCategorySupported,
      registrationInput,
      titleValue,
      categories,
    });
    setLookupPending(false);
    if (!result.ok) {
      setLookupError(result.error);
      return;
    }
    setRegistrationInput(result.registrationInput);
    if (result.selectedCategoryId) {
      setSelectedCategoryId(result.selectedCategoryId);
    }
    if (result.titleValue) {
      setTitleValue(result.titleValue);
    }
    if (result.appliedAttributeIds.length > 0) {
      const category =
        categories.find((candidate) => candidate.id === result.selectedCategoryId) ??
        selectedCategory;
      if (category) {
        setAttributeValues((currentValues) =>
          pruneHiddenAttributes(
            { ...currentValues, ...result.attributeValues },
            category,
          ),
        );
      }
    }
    setFieldErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      for (const attributeId of result.appliedAttributeIds) {
        delete nextErrors[`attr-${attributeId}`];
      }
      if (result.clearTitleError) {
        delete nextErrors.title;
      }
      return nextErrors;
    });
    setLookupMeta(result.meta);
  }

  function showFieldErrors(errors: Record<string, string[]>, next: GuidedListingStep) {
    setFieldErrors(errors);
    setStep(next);
    const attributeKey = Object.keys(errors).find((key) => key.startsWith("attr-"));
    if (attributeKey) {
      const sectionId = optionalSectionForAttribute(optionalSections, attributeKey.slice(5));
      if (sectionId) setOptionalSectionId(sectionId);
    }
    setFocusFieldId(focusIdForFieldErrors(errors));
  }

  function activePanelIsValid() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-listing-step="${step}"]`);
    if (!panel) return true;
    const fields = panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    );
    for (const field of fields) {
      if (field.disabled || field.type === "hidden") continue;
      if (!field.reportValidity()) return false;
    }
    return true;
  }

  function selectStep(target: GuidedListingStep) {
    if (target === step) return;
    const block = guidedNavigationBlock({
      from: step,
      to: target,
      photoUploadsBusy,
      requiredComplete,
      optionalValid,
      photosComplete,
      advertComplete,
    });
    if (block) {
      setError(block.message);
      if (block.step === 1) {
        if (configurationError) setError(configurationError);
        showFieldErrors(attributeErrorSplit.required, 1);
        return;
      }
      if (block.step === 2) {
        showFieldErrors(attributeErrorSplit.optional, 2);
        return;
      }
      if (block.step === 4 && !advertValidation.ok) {
        showFieldErrors(advertValidation.fieldErrors, 4);
        return;
      }
      if (block.step !== step) setStep(block.step);
      return;
    }
    setFieldErrors({});
    setError(null);
    setFocusFieldId(null);
    setTrustConfirmationMissing(false);
    setPrivateSellerTermsMissing(false);
    setStep(target);
  }

  function nextStep() {
    if (step >= 5) return;
    const target = (step + 1) as GuidedListingStep;
    const block = guidedNavigationBlock({
      from: step,
      to: target,
      photoUploadsBusy,
      requiredComplete,
      optionalValid,
      photosComplete,
      advertComplete,
    });
    if (block) {
      selectStep(target);
      return;
    }
    if ((step === 1 || step === 4) && !activePanelIsValid()) return;
    selectStep(target);
  }

  function prevStep() {
    if (step <= 1) return;
    selectStep((step - 1) as GuidedListingStep);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tryBeginSubmitFlight(submitFlightRef)) {
      return;
    }
    if (photoUploadsBusy) {
      setError("Please wait for all photo uploads to finish before submitting.");
      releaseSubmitFlight(submitFlightRef);
      return;
    }
    setError(null);
    setFieldErrors({});
    if (revisionLocked) {
      setError("Your changes are awaiting review and cannot be edited yet.");
      releaseSubmitFlight(submitFlightRef);
      return;
    }

    const form = new FormData(e.currentTarget);
    if (!trustConfirmed) {
      setTrustConfirmationMissing(true);
      releaseSubmitFlight(submitFlightRef);
      return;
    }
    setTrustConfirmationMissing(false);
    if (mode === "private" && !privateSellerTermsAccepted) {
      setPrivateSellerTermsMissing(true);
      releaseSubmitFlight(submitFlightRef);
      return;
    }
    setPrivateSellerTermsMissing(false);

    const attributes = selectedCategory
      ? collectListingAttributes(selectedCategory.attributes, form)
      : [];
    if (selectedCategory) {
      const clientAttributeValidation = validateListingDetailsStep({
        selectedCategoryId,
        selectedCategory,
        attributeValues: Object.fromEntries(
          attributes.map((attribute) => [
            attribute.attributeDefinitionId,
            attribute.value,
          ]),
        ),
        retainedAttributes: retainedAttributeValues,
        enforceListingNs,
      });
      if (!clientAttributeValidation.ok) {
        const mapped = guidedStepForFieldErrors(clientAttributeValidation.fieldErrors, {
          attributeSteps,
          fallback: 1,
        });
        showFieldErrors(clientAttributeValidation.fieldErrors, mapped);
        if (clientAttributeValidation.configurationError) {
          setError(clientAttributeValidation.configurationError);
          setStep(1);
        }
        releaseSubmitFlight(submitFlightRef);
        return;
      }
    }

    startTransition(async () => {
      try {
        const navigation = await executeCreateListingSubmit({
          form,
          attributes,
          mode,
          skipCheckout,
          isEditingDraft,
          uploadedImages,
          listingIdRef,
          photoRevisionRef,
          photoMutationRef,
          submitFlightRef,
          vehicleCatalogueSelection,
          isVehicleCatalogueCategory,
          selectedCategoryAttributes: selectedCategory?.attributes ?? [],
          attributeSteps,
          createMutationId: createPhotoMutationId,
          includeFeatured: showFeaturedOffer && includeFeatured,
          listingFeeDue,
          onListingId: setPendingListingId,
          onDraftUrl: (href) => window.history.replaceState(null, "", href),
          onPhotoRevision: setPhotoRevision,
          openCheckout: (url) => {
            clearDemoOutcomeError();
            return openCheckout(url);
          },
        });
        if (navigation.kind === "checkout" || navigation.kind === "demo") {
          trackMarketplaceEvent("listing_submitted", { listingId: listingIdRef.current, context: "listing" });
          trackMarketplaceEvent("checkout_started", { listingId: listingIdRef.current, context: "listing" });
        } else if (navigation.kind === "success") {
          trackMarketplaceEvent("listing_submitted", { listingId: listingIdRef.current, context: "listing" });
        }
        if (navigation.kind === "stay") {
          if (navigation.error) setError(navigation.error);
          if (navigation.fieldErrors) {
            showFieldErrors(
              navigation.fieldErrors,
              navigation.step ??
                guidedStepForFieldErrors(navigation.fieldErrors, {
                  attributeSteps,
                  fallback: step,
                }),
            );
          }
          if (navigation.step) setStep(navigation.step);
          return;
        }
        if (navigation.kind === "demo") {
          return;
        }
        router.replace(navigation.href);
      } catch {
        releaseSubmitFlight(submitFlightRef);
        setError(
          "Something interrupted submission. Your entered details and selected photos are still in this form. If checkout may have opened or payment may have completed, check My listings before retrying.",
        );
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {editMode === "revision"
              ? `Edit live listing - Step ${step} of 5`
              : editMode === "resubmit"
                ? `Edit and resubmit - Step ${step} of 5`
                : isEditingDraft
                  ? `Continue Editing - Step ${step} of 5`
                  : `Create Listing - Step ${step} of 5`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editMode === "revision" ? (
            <p className="mb-4 text-sm text-text-secondary">
              {revisionLocked
                ? "Your changes are awaiting review. The current live listing stays public."
                : "The current live listing stays public until these changes are approved."}
            </p>
          ) : null}
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
            <GuidedListingRail
              current={step}
              completion={completion}
              attention={attention}
              onSelect={selectStep}
            >
              <GuidedListingStepPanels
                step={step}
                categories={categories}
                regions={regions}
                selectedCategoryId={selectedCategoryId}
                selectedCategoryName={selectedCategory?.name}
                selectedCategorySlug={selectedCategory?.slug}
                onCategoryChange={handleCategoryChange}
                registrationInput={registrationInput}
                onRegistrationInput={(value) => {
                  setRegistrationInput(value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""));
                  setLookupError(null);
                }}
                onRegistrationBlur={() => {
                  if (!registrationInput.trim()) return;
                  setRegistrationInput(formatRegistrationForDisplay(registrationInput));
                }}
                lookupPending={lookupPending}
                lookupError={lookupError}
                lookupMeta={lookupMeta}
                onLookup={() => void handleVehicleLookup()}
                isLookupCategorySupported={isLookupCategorySupported}
                hasSelectedCategory={Boolean(selectedCategory)}
                titleValue={titleValue}
                onTitleChange={setTitleValue}
                descriptionValue={descriptionValue}
                onDescriptionChange={setDescriptionValue}
                priceValue={priceValue}
                onPriceChange={setPriceValue}
                regionId={regionId}
                onRegionChange={setRegionId}
                requiredFields={guidedFields.required}
                optionalSections={optionalSections}
                activeOptionalSectionId={activeOptionalSectionId}
                onOptionalSectionChange={setOptionalSectionId}
                attributeValues={attributeValues}
                enforceListingNs={enforceListingNs}
                getFieldError={getFieldError}
                onAttributeChange={handleAttributeChange}
                isVehicleCatalogueCategory={isVehicleCatalogueCategory}
                makeAttribute={makeAttribute}
                modelAttribute={modelAttribute}
                vehicleMakes={vehicleMakes}
                onCatalogueChange={handleVehicleCatalogueChange}
                onCatalogueSelectionChange={setVehicleCatalogueSelection}
                maxImages={maxImages}
                uploadedImages={uploadedImages}
                onImagesChange={setUploadedImages}
                onPhotoBusyChange={setPhotoUploadsBusy}
                mode={mode}
                isFreeForUser={isFreeForUser}
                showFeaturedOffer={showFeaturedOffer}
                listingFeePence={listingFeePence}
                featuredUpgradePricePence={featuredUpgradePricePence}
                listingFeeDue={listingFeeDue}
                includeFeatured={includeFeatured}
                onIncludeFeaturedChange={setIncludeFeatured}
                trustConfirmed={trustConfirmed}
                trustConfirmationMissing={trustConfirmationMissing}
                privateSellerTermsAccepted={privateSellerTermsAccepted}
                privateSellerTermsMissing={privateSellerTermsMissing}
                onTrustChange={(accepted) => {
                  setTrustConfirmed(accepted);
                  if (accepted) setTrustConfirmationMissing(false);
                }}
                onPrivateTermsChange={(accepted) => {
                  setPrivateSellerTermsAccepted(accepted);
                  if (accepted) setPrivateSellerTermsMissing(false);
                }}
                onEditStep={selectStep}
                revisionLocked={revisionLocked}
              />
            </GuidedListingRail>

            {error ? <FormErrorSummary messages={[error]} /> : null}

            <div className="flex items-center gap-3">
              {step > 1 ? (
                <Button type="button" variant="ghost" onClick={prevStep}>
                  Back
                </Button>
              ) : null}
              {step < 5 ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={nextStep}
                  disabled={step === 3 && photoUploadsBusy}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={isPending}
                  disabled={isPending || photoUploadsBusy}
                >
                  {editMode === "revision"
                    ? "Submit changes for review"
                    : editMode === "resubmit"
                      ? "Resubmit for review"
                      : mode === "dealer" || isFreeForUser
                        ? "Submit Listing"
                        : "Continue to Checkout"}
                </Button>
              )}
            </div>

            <p className="text-xs text-text-tertiary text-center">
              Your listing will be reviewed by our moderation team before going live.
            </p>
          </form>
        </CardContent>
      </Card>

      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel="listing payment"
        onManualCheckoutOpened={() => {
          if (pendingListingId) {
            router.replace(getHostedCheckoutHref({ listingId: pendingListingId, mode }));
          }
        }}
        demoOutcomeControls={
          pendingListingId
            ? {
                isPending: isSimulatingDemoOutcome,
                error: demoOutcomeError,
                onSimulateSuccess: () => handleSimulatedDemoOutcome("success"),
                onSimulateDeclined: () => handleSimulatedDemoOutcome("declined"),
              }
            : undefined
        }
      />
    </>
  );
}
