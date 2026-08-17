"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simulateDemoListingPaymentOutcome } from "@/actions/payments";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";
import { getAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { CreateListingDeclarations } from "./create-listing-form.declarations";
import { groupWriteOffWithVehicleDetails } from "@/lib/listings/listing-ns-ui";
import {
  CreateListingAttributeFields,
  ListingFieldLabel,
} from "./create-listing-attribute-fields";
import { validateListingDetailsStep } from "./create-listing-form.validation";
import {
  collectListingAttributes,
  executeCreateListingSubmit,
  releaseSubmitFlight,
  tryBeginSubmitFlight,
} from "./create-listing-submit";
import { runVehicleLookup } from "./create-listing-form.lookup";
import {
  CATEGORY_TILE_META,
  DEFAULT_CATEGORY_TILE_ICON,
} from "./create-listing-form.constants";
import {
  pruneHiddenAttributes,
  REGISTRATION_LOOKUP_CATEGORY_SLUGS,
} from "./create-listing-form.helpers";
import type { EditableDraft } from "@/lib/listings/editable-draft";
import { getListingPhotoLimit } from "@/lib/listings/photo-limits";
import { formatRegistrationForDisplay } from "@/lib/utils/registration";
import type { VehicleMakeOption } from "@/lib/vehicle-catalogue/queries";
import {
  VehicleCatalogueFields,
  type VehicleCatalogueSelection,
} from "./vehicle-catalogue-fields";

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
}

export function CreateListingForm({
  categories,
  regions,
  vehicleMakes = [],
  mode = "private",
  isFreeForUser = false,
  initialDraft = null,
  enforceListingNs = false,
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
  const revisionLocked = Boolean(initialDraft?.revisionPending);
  const [isPending, startTransition] = useTransition();
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialDraft?.categoryId ?? "");
  const [titleValue, setTitleValue] = useState(initialDraft?.title ?? "");
  const [pendingListingId, setPendingListingId] = useState<string | null>(initialDraft?.id ?? null);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialDraft?.attributes.map((attribute) => [attribute.attributeDefinitionId, attribute.value]) ??
        []
    )
  );
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>(
    () => initialDraft?.images.map(toUploadedImage) ?? [],
  );
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
  const isDetailsStep = step === 1;
  const selectedFuelType = fuelTypeAttribute
    ? attributeValues[fuelTypeAttribute.id]
    : undefined;
  const visibleAttributes = groupWriteOffWithVehicleDetails(
    selectedCategory?.attributes.filter(
      (attr) =>
        !isVehicleCatalogueCategory ||
        (attr.slug !== "make" && attr.slug !== "model"),
    ) ?? [],
  )
    .map((attr) => ({
      attr,
      config: getAttributeFieldConfig(selectedCategory?.slug, attr, selectedFuelType),
    }))
    .filter(
      (
        item
      ): item is {
        attr: AttributeDef;
        config: NonNullable<ReturnType<typeof getAttributeFieldConfig>>;
      } => item.config !== null
    );
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
  }

  function handleAttributeChange(attribute: AttributeDef, value: string) {
    setAttributeValues((currentValues) => {
      const nextValues = { ...currentValues, [attribute.id]: value };
      if (!selectedCategory) {
        return nextValues;
      }

      if (attribute.slug === "fuel-type") {
        return pruneHiddenAttributes(nextValues, selectedCategory);
      }

      if (attribute.slug === "make") {
        const modelAttribute = selectedCategory.attributes.find((candidate) => candidate.slug === "model");
        if (modelAttribute) delete nextValues[modelAttribute.id];
      }

      return nextValues;
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

  function nextStep() {
    if (step === 1) {
      const detailsValidation = validateListingDetailsStep({
        selectedCategoryId,
        selectedCategory,
        attributeValues,
        enforceListingNs,
      });
      if (!detailsValidation.ok) {
        setFieldErrors(detailsValidation.fieldErrors);
        if (detailsValidation.configurationError) {
          setError(detailsValidation.configurationError);
        }
        return;
      }
      if (formRef.current && !formRef.current.reportValidity()) {
        return;
      }
    }
    if (step === 2 && uploadedImages.length < 2) {
      setFieldErrors({});
      setError("Please upload at least 2 photos before continuing.");
      return;
    }
    setFieldErrors({});
    setError(null);
    setTrustConfirmationMissing(false);
    setStep((currentStep) => Math.min(3, currentStep + 1));
  }

  function prevStep() {
    setFieldErrors({});
    setError(null);
    setTrustConfirmationMissing(false);
    setStep((currentStep) => Math.max(1, currentStep - 1));
  }

  function handleSimulatedDemoOutcome(outcome: "success" | "declined") {
    if (!pendingListingId) {
      setDemoOutcomeError("A listing must be created before simulating payment.");
      return;
    }

    setDemoOutcomeError(null);
    startSimulatingDemoOutcome(async () => {
      const result = await simulateDemoListingPaymentOutcome({
        listingId: pendingListingId,
        flow: mode,
        outcome,
      });

      if (result.error) {
        setDemoOutcomeError(
          typeof result.error === "string"
            ? result.error
            : "Could not simulate the demo payment outcome."
        );
        return;
      }

      setDemoDialogOpen(false);

      if (result.data?.nextUrl) {
        router.replace(result.data.nextUrl);
        return;
      }

      router.refresh();
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tryBeginSubmitFlight(submitFlightRef)) {
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
        enforceListingNs,
      });
      if (!clientAttributeValidation.ok) {
        setFieldErrors(clientAttributeValidation.fieldErrors);
        if (clientAttributeValidation.configurationError) {
          setError(clientAttributeValidation.configurationError);
        }
        setStep(1);
        releaseSubmitFlight(submitFlightRef);
        return;
      }
    }

    startTransition(async () => {
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
        createMutationId: createPhotoMutationId,
        onListingId: setPendingListingId,
        onDraftUrl: (href) => router.replace(href),
        onPhotoRevision: setPhotoRevision,
        openCheckout: (url) => {
          setDemoOutcomeError(null);
          openCheckout(url);
        },
      });
      if (navigation.kind === "stay") {
        if (navigation.error) setError(navigation.error);
        if (navigation.fieldErrors) {
          setFieldErrors(navigation.fieldErrors);
          setStep(navigation.step ?? 1);
        }
        return;
      }
      if (navigation.kind === "demo") {
        return;
      }
      router.replace(navigation.href);
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {editMode === "revision"
              ? `Edit live listing - Step ${step} of 3`
              : editMode === "resubmit"
                ? `Edit and resubmit - Step ${step} of 3`
                : isEditingDraft
                  ? `Continue Editing - Step ${step} of 3`
                  : `Create Listing - Step ${step} of 3`}
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
          <div className={isDetailsStep ? "space-y-6" : "hidden"}>
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Category
                </h3>
                <input type="hidden" name="categoryId" value={selectedCategoryId} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {categories.map((category) => {
                    const isSelected = category.id === selectedCategoryId;
                    const meta = CATEGORY_TILE_META[category.slug];
                    const Icon = meta?.icon ?? DEFAULT_CATEGORY_TILE_ICON;
                    return (
                      <Button
                        key={category.id}
                        type="button"
                        variant="ghost"
                        aria-pressed={isSelected}
                        onClick={() => handleCategoryChange(category.id)}
                        className={[
                          "h-16 w-full flex-col gap-1 rounded-md border text-[11px] leading-tight sm:text-xs",
                          "font-semibold normal-case not-italic",
                          isSelected
                            ? (meta?.selectedClass ??
                              "border-neon-blue-400 bg-neon-blue-500/15 text-white ring-2 ring-neon-blue-500/70")
                            : "border-border bg-surface/40 text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                        ].join(" ")}
                        leftIcon={
                          <Icon
                            className={`h-4 w-4 ${isSelected ? "text-white" : meta?.idleIconClass ?? "text-neon-blue-400"}`}
                          />
                        }
                      >
                        {category.name}
                      </Button>
                    );
                  })}
                </div>
                {getFieldError("categoryId") ? (
                  <p id="category-error" className="text-xs text-text-energy">
                    {getFieldError("categoryId")}
                  </p>
                ) : (
                  <p className="text-xs text-text-secondary">
                    Select the listing type first, then use number plate lookup.
                  </p>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Number Plate Lookup
                </h3>
                <p className="text-xs text-text-secondary">
                  Enter a UK or Isle of Man plate to auto-fill available vehicle details.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Input
                    label="Number Plate"
                    value={registrationInput}
                    onChange={(event) => {
                      setRegistrationInput(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9 -]/g, "")
                      );
                      setLookupError(null);
                    }}
                    onBlur={() => {
                      if (!registrationInput.trim()) return;
                      setRegistrationInput(formatRegistrationForDisplay(registrationInput));
                    }}
                    placeholder="e.g. AB12 CDE or MAN 123"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleVehicleLookup()}
                    loading={lookupPending}
                    disabled={lookupPending}
                  >
                    Lookup Vehicle
                  </Button>
                </div>
                {!selectedCategory ? (
                  <p className="text-xs text-text-secondary">
                    If category is empty, lookup will try to auto-select one from returned data.
                  </p>
                ) : !isLookupCategorySupported ? (
                  <p className="text-xs text-text-secondary">
                    Lookup is available for car, van, motorbike, and motorhome categories.
                  </p>
                ) : null}
                {lookupError ? (
                  <p className="text-xs text-text-error">{lookupError}</p>
                ) : null}
                {lookupMeta ? (
                  <p className="text-xs text-text-secondary">{lookupMeta}</p>
                ) : null}
              </div>

              <Input
                label="Title"
                name="title"
                value={titleValue}
                onChange={(event) => setTitleValue(event.target.value)}
                required={isDetailsStep}
                minLength={5}
                maxLength={120}
                placeholder="e.g. 2019 BMW 320d M Sport"
                error={getFieldError("title")}
              />

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="description"
                  className="text-sm font-medium text-text-primary"
                >
                  <ListingFieldLabel label="Description" required />
                </label>
                <textarea
                  id="description"
                  name="description"
                  defaultValue={initialDraft?.description ?? ""}
                  required={isDetailsStep}
                  minLength={20}
                  maxLength={5000}
                  rows={6}
                  aria-invalid={getFieldError("description") ? true : undefined}
                  aria-describedby={getFieldError("description") ? "description-error" : undefined}
                  placeholder="Describe your item in detail..."
                  className={`flex w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline ${
                    getFieldError("description") ? "border-neon-red-500" : "border-border"
                  }`}
                />
                {getFieldError("description") ? (
                  <p id="description-error" className="text-xs text-text-energy">
                    {getFieldError("description")}
                  </p>
                ) : null}
              </div>

              <Input
                label="Price (£)"
                name="price"
                type="number"
                defaultValue={initialDraft?.price}
                required={isDetailsStep}
                min={1}
                max={1000000}
                step={0.01}
                inputMode="decimal"
                placeholder="e.g. 15000"
                error={getFieldError("price")}
              />

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="regionId"
                  className="text-sm font-medium text-text-primary"
                >
                  <ListingFieldLabel label="Region" required />
                </label>
                <select
                  id="regionId"
                  name="regionId"
                  required={isDetailsStep}
                  defaultValue={initialDraft?.regionId ?? ""}
                  aria-invalid={getFieldError("regionId") ? true : undefined}
                  aria-describedby={getFieldError("regionId") ? "region-error" : undefined}
                  className={`flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline ${
                    getFieldError("regionId") ? "border-neon-red-500" : "border-border"
                  }`}
                >
                  <option value="">Select a region</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {getFieldError("regionId") ? (
                  <p id="region-error" className="text-xs text-text-energy">
                    {getFieldError("regionId")}
                  </p>
                ) : null}
              </div>

          </div>

          <div className={step === 2 ? "space-y-3" : "hidden"}>
              <p className="text-sm text-text-secondary">
                Add between 2 and {maxImages} photos. Use a clean first image and include exterior and interior shots.
              </p>
              <ImageUpload
                images={uploadedImages}
                onImagesChange={setUploadedImages}
                maxImages={maxImages}
              />
          </div>

          <div className={step === 3 ? "space-y-3 rounded-lg border border-border p-4" : "hidden"}>
              <h3 className="text-base font-semibold text-text-primary">Preview</h3>
              <p className="text-sm text-text-secondary">
                {mode === "dealer" || isFreeForUser
                  ? "Review your listing and submit. Your listing will go to moderation once submitted."
                  : "Review your listing and continue to checkout. Your listing will be submitted for moderation after payment."}
              </p>
              <p className="text-sm text-text-secondary">
                Photos selected: {uploadedImages.length}
              </p>
              <CreateListingDeclarations
                mode={mode}
                step={step}
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
              />
          </div>

          {/* Dynamic category attributes */}
          {selectedCategory &&
            (visibleAttributes.length > 0 || isVehicleCatalogueCategory) && (
            <div className={isDetailsStep ? "space-y-4 rounded-lg border border-border p-4" : "hidden"}>
              <h3 className="text-sm font-semibold text-text-primary">
                {selectedCategory.name} Details
              </h3>
              {isVehicleCatalogueCategory && makeAttribute && modelAttribute ? (
                <VehicleCatalogueFields
                  makeAttribute={makeAttribute}
                  modelAttribute={modelAttribute}
                  makes={vehicleMakes}
                  makeValue={attributeValues[makeAttribute.id] ?? ""}
                  modelValue={attributeValues[modelAttribute.id] ?? ""}
                  makeError={getFieldError(`attr-${makeAttribute.id}`)}
                  modelError={getFieldError(`attr-${modelAttribute.id}`)}
                  required={isDetailsStep}
                  onChange={handleVehicleCatalogueChange}
                  onSelectionChange={setVehicleCatalogueSelection}
                />
              ) : null}
              <CreateListingAttributeFields
                categorySlug={selectedCategory.slug}
                visibleAttributes={visibleAttributes}
                attributeValues={attributeValues}
                isDetailsStep={isDetailsStep}
                enforceListingNs={enforceListingNs}
                getFieldError={getFieldError}
                onAttributeChange={handleAttributeChange}
              />
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-border bg-surface-elevated px-3 py-2">
              <p className="text-sm text-text-secondary">{error}</p>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={prevStep}>
                Back
              </Button>
            ) : null}
            {step < 3 ? (
              <Button type="button" size="lg" className="w-full" onClick={nextStep}>
                Continue
              </Button>
            ) : (
              <Button type="submit" size="lg" className="w-full" loading={isPending}>
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

function toUploadedImage(image: EditableDraft["images"][number]): UploadedImage {
  return {
    ...image,
    uploadIntentId: image.uploadIntentId ?? image.id,
    provider: image.provider,
  };
}

function createPhotoMutationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
