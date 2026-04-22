"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createListing,
  saveListingImages,
  submitListingForReview,
} from "@/actions/listings";
import {
  payForListing,
  simulateDemoListingPaymentOutcome,
} from "@/actions/payments";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";
import {
  getAttributeFieldConfig,
  validateListingAttributes,
} from "@/lib/listings/attribute-ui";
import { mapVehicleResultToListingAttributes } from "@/lib/listings/vehicle-autofill";
import type { VehicleCheckResponse } from "@/lib/services/vehicle-check-types";
import { formatRegistrationForDisplay } from "@/lib/utils/registration";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import {
  CATEGORY_TILE_META,
  DEFAULT_CATEGORY_TILE_ICON,
} from "./create-listing-form.constants";
import {
  buildSuggestedListingTitle,
  extractLookupErrorMessage,
  inferCategoryFromLookupResult,
  pruneHiddenAttributes,
  REGISTRATION_LOOKUP_CATEGORY_SLUGS,
} from "./create-listing-form.helpers";

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
  mode?: "private" | "dealer";
  isFreeForUser?: boolean;
}

export function CreateListingForm({ categories, regions, mode = "private", isFreeForUser = false }: Props) {
  const router = useRouter();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [titleValue, setTitleValue] = useState("");
  const [pendingListingId, setPendingListingId] = useState<string | null>(null);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [supportPlatform, setSupportPlatform] = useState(false);
  const [registrationInput, setRegistrationInput] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupMeta, setLookupMeta] = useState<string | null>(null);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const isLookupCategorySupported = Boolean(
    selectedCategory &&
      REGISTRATION_LOOKUP_CATEGORY_SLUGS.has(selectedCategory.slug)
  );
  const fuelTypeAttribute = selectedCategory?.attributes.find((attr) => attr.slug === "fuel-type");
  const isDetailsStep = step === 1;
  const selectedFuelType = fuelTypeAttribute
    ? attributeValues[fuelTypeAttribute.id]
    : undefined;
  const visibleAttributes = selectedCategory?.attributes
    .map((attr) => ({
      attr,
      config: getAttributeFieldConfig(selectedCategory.slug, attr, selectedFuelType),
    }))
    .filter(
      (
        item
      ): item is {
        attr: AttributeDef;
        config: NonNullable<ReturnType<typeof getAttributeFieldConfig>>;
      } => item.config !== null
    ) ?? [];
  const fieldErrorMessages = [
    ...Object.values(fieldErrors).flat(),
    ...(error ? [error] : []),
  ];

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

      return nextValues;
    });
  }

  async function handleVehicleLookup() {
    if (selectedCategory && !isLookupCategorySupported) {
      setLookupError(
        "Vehicle lookup is available for car, van, motorbike, and motorhome listings."
      );
      setLookupMeta(null);
      return;
    }

    const submittedRegistration = registrationInput.trim();
    if (!submittedRegistration) {
      setLookupError("Enter a number plate to run the lookup.");
      setLookupMeta(null);
      return;
    }

    setLookupPending(true);
    setLookupError(null);
    setLookupMeta(null);

    try {
      const response = await fetch("/api/vehicle-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registration: submittedRegistration }),
      });

      const payload = (await response.json().catch(() => null)) as
        | VehicleCheckResponse
        | Record<string, unknown>
        | null;

      if (!response.ok || !payload || !("success" in payload) || payload.success !== true) {
        setLookupError(extractLookupErrorMessage(payload));
        return;
      }
      const lookupPayload = payload as VehicleCheckResponse;

      let activeCategory = selectedCategory;
      let autoSelectedCategoryName: string | null = null;
      if (!activeCategory) {
        const inferredCategory = inferCategoryFromLookupResult(
          lookupPayload.result,
          categories
        );
        if (!inferredCategory) {
          setLookupError(
            "Could not auto-select a category from the lookup result. Please choose a category and try again."
          );
          setLookupMeta(null);
          return;
        }
        activeCategory = inferredCategory;
        autoSelectedCategoryName = inferredCategory.name;
        setSelectedCategoryId(inferredCategory.id);
      }

      if (!REGISTRATION_LOOKUP_CATEGORY_SLUGS.has(activeCategory.slug)) {
        setLookupError(
          "Vehicle lookup is available for car, van, motorbike, and motorhome listings."
        );
        setLookupMeta(null);
        return;
      }

      const mapped = mapVehicleResultToListingAttributes({
        definitions: activeCategory.attributes,
        result: lookupPayload.result,
      });

      const yearDefinition = activeCategory.attributes.find(
        (attribute) => attribute.slug === "year"
      );
      const makeDefinition = activeCategory.attributes.find(
        (attribute) => attribute.slug === "make"
      );
      const modelDefinition = activeCategory.attributes.find(
        (attribute) => attribute.slug === "model"
      );
      const suggestedTitle = buildSuggestedListingTitle({
        year: yearDefinition ? mapped.values[yearDefinition.id] ?? null : null,
        make:
          (makeDefinition ? mapped.values[makeDefinition.id] ?? null : null) ??
          lookupPayload.result.vehicle?.make ??
          lookupPayload.result.motHistory?.make ??
          null,
        model:
          (modelDefinition ? mapped.values[modelDefinition.id] ?? null : null) ??
          lookupPayload.result.vehicle?.model ??
          lookupPayload.result.motHistory?.model ??
          null,
      });
      const didSuggestTitle = Boolean(suggestedTitle && !titleValue.trim());

      setRegistrationInput(formatRegistrationForDisplay(submittedRegistration));
      if (didSuggestTitle && suggestedTitle) {
        setTitleValue(suggestedTitle);
      }

      if (mapped.appliedAttributeIds.length === 0 && !didSuggestTitle) {
        setLookupMeta(
          "Vehicle found, but no matching listing fields were available to auto-fill."
        );
        return;
      }

      setAttributeValues((currentValues) =>
        pruneHiddenAttributes(
          { ...currentValues, ...mapped.values },
          activeCategory
        )
      );
      setFieldErrors((currentErrors) => {
        const nextErrors = { ...currentErrors };
        for (const attributeId of mapped.appliedAttributeIds) {
          delete nextErrors[`attr-${attributeId}`];
        }
        if (didSuggestTitle) {
          delete nextErrors.title;
        }
        return nextErrors;
      });

      const statusMessages: string[] = [];
      if (autoSelectedCategoryName) {
        statusMessages.push(`Category auto-selected: ${autoSelectedCategoryName}`);
      }
      if (mapped.appliedAttributeIds.length > 0) {
        statusMessages.push(
          `Auto-filled ${mapped.appliedAttributeIds.length} field${mapped.appliedAttributeIds.length === 1 ? "" : "s"} from registration data`
        );
      }
      if (didSuggestTitle) {
        statusMessages.push("Suggested a listing title");
      }

      const warningSuffix = lookupPayload.result.warnings.length
        ? ` (${lookupPayload.result.warnings.length} warning${lookupPayload.result.warnings.length === 1 ? "" : "s"} reported in lookup data).`
        : ".";
      setLookupMeta(
        `${statusMessages.join(". ")}. Please review before submitting${warningSuffix}`
      );
    } catch {
      setLookupError("Vehicle lookup failed. Please try again.");
    } finally {
      setLookupPending(false);
    }
  }

  function nextStep() {
    if (step === 1) {
      if (!selectedCategoryId) {
        setFieldErrors((current) => ({
          ...current,
          categoryId: ["Please choose a category."],
        }));
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
    setStep((currentStep) => Math.min(3, currentStep + 1));
  }

  function prevStep() {
    setFieldErrors({});
    setError(null);
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
        router.push(result.data.nextUrl);
        return;
      }

      router.refresh();
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    if (!trustConfirmed) {
      setError(
        "Please confirm the vehicle is not stolen and has no outstanding finance."
      );
      return;
    }

    const attributes: Array<{ attributeDefinitionId: string; value: string }> = [];
    if (selectedCategory) {
      for (const attr of selectedCategory.attributes) {
        const val = (form.get(`attr-${attr.id}`) as string | null)?.trim() ?? "";
        if (val) {
          attributes.push({ attributeDefinitionId: attr.id, value: val });
        }
      }

      const clientAttributeValidation = validateListingAttributes({
        categorySlug: selectedCategory.slug,
        definitions: selectedCategory.attributes,
        attributes,
      });
      if (Object.keys(clientAttributeValidation.fieldErrors).length > 0) {
        setFieldErrors(clientAttributeValidation.fieldErrors);
        setStep(1);
        return;
      }
    }

    startTransition(async () => {
      const result = await createListing({
        title: form.get("title") as string,
        description: form.get("description") as string,
        price: Math.round(parseFloat(form.get("price") as string) * 100),
        categoryId: form.get("categoryId") as string,
        regionId: form.get("regionId") as string,
        trustDeclarationAccepted: trustConfirmed,
        attributes,
      });

      if (result.error) {
        if (typeof result.error === "string") {
          setError(result.error);
        } else {
          setFieldErrors(result.error);
          setStep(1);
        }
        return;
      }

      if (result.data) {
        setPendingListingId(result.data.id);
        if (uploadedImages.length > 0) {
          const saveResult = await saveListingImages(result.data.id, uploadedImages);
          if (saveResult?.error) {
            setError(
              typeof saveResult.error === "string"
                ? saveResult.error
                : "Failed to save images. Please try again."
            );
            return;
          }
        }

        const payResult = await payForListing(result.data.id, {
          supportAmountPence:
            mode === "private" && supportPlatform ? 500 : 0,
        });
        if (payResult.error) {
          setError(
            typeof payResult.error === "string"
              ? payResult.error
              : "Payment setup failed. Please try again."
          );
          return;
        }

        if (payResult.data?.skippedPayment) {
          const reviewResult = await submitListingForReview(result.data.id);
          if (reviewResult?.error) {
            setError(
              typeof reviewResult.error === "string"
                ? reviewResult.error
                : "Failed to submit listing for review."
            );
            return;
          }
        }

        if (payResult.data?.checkoutUrl) {
          setDemoOutcomeError(null);
          openCheckout(payResult.data.checkoutUrl);
          if (isRippleDemoCheckoutUrl(payResult.data.checkoutUrl)) {
            return;
          }
          const checkoutSearch = new URLSearchParams({
            listing: result.data.id,
            flow: mode,
            opened: "1",
          });
          router.push(`/sell/checkout?${checkoutSearch.toString()}`);
          return;
        }

        const search = new URLSearchParams({
          listing: result.data.id,
          flow: mode,
          payment: payResult.data?.skippedPayment ? "skipped" : "paid",
        });
        router.push(`/sell/success?${search.toString()}`);
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            Create Listing - Step {step} of 3
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          <div className={isDetailsStep ? "space-y-6" : "hidden"}>
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Category
                </h3>
                <input type="hidden" name="categoryId" value={selectedCategoryId} />
                <div className="grid grid-cols-4 gap-2">
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
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
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
                  Region
                </label>
                <select
                  id="regionId"
                  name="regionId"
                  required={isDetailsStep}
                  defaultValue=""
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
                Add between 2 and 20 photos. Use a clean first image and include exterior and interior shots.
              </p>
              <ImageUpload
                images={uploadedImages}
                onImagesChange={setUploadedImages}
                maxImages={20}
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
              <Checkbox
                checked={trustConfirmed}
                onCheckedChange={(checked) => setTrustConfirmed(checked === true)}
                label="I confirm this vehicle is not stolen and has no outstanding finance"
              />
              {mode === "private" && (
                <Checkbox
                  checked={supportPlatform}
                  onCheckedChange={(checked) => setSupportPlatform(checked === true)}
                  label="Optional: add £5 to support the platform"
                />
              )}
          </div>

          {/* Dynamic category attributes */}
          {selectedCategory && visibleAttributes.length > 0 && (
            <div className={isDetailsStep ? "space-y-4 rounded-lg border border-border p-4" : "hidden"}>
              <h3 className="text-sm font-semibold text-text-primary">
                {selectedCategory.name} Details
              </h3>
              {visibleAttributes.map(({ attr, config }) => {
                const fieldName = `attr-${attr.id}`;
                const fieldError = getFieldError(fieldName);
                const label = `${attr.name}${attr.required ? " *" : ""}`;

                if (config.control === "select") {
                  return (
                    <div key={attr.id} className="flex flex-col gap-1">
                      <label htmlFor={fieldName} className="text-sm font-medium text-text-primary">
                        {label}
                      </label>
                      <select
                        id={fieldName}
                        name={fieldName}
                        required={isDetailsStep && attr.required}
                        value={attributeValues[attr.id] ?? ""}
                        onChange={(e) => handleAttributeChange(attr, e.target.value)}
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby={fieldError ? `${fieldName}-error` : undefined}
                        className={`flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline ${
                          fieldError ? "border-neon-red-500" : "border-border"
                        }`}
                      >
                        <option value="">
                          {attr.slug === "make" ? "Select a make" : `Select ${attr.name.toLowerCase()}`}
                        </option>
                        {config.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      {fieldError ? (
                        <p id={`${fieldName}-error`} className="text-xs text-text-energy">
                          {fieldError}
                        </p>
                      ) : config.helperText ? (
                        <p className="text-xs text-text-secondary">{config.helperText}</p>
                      ) : null}
                    </div>
                  );
                }

                if (config.control === "checkbox") {
                  return (
                    <div key={attr.id} className="space-y-2">
                      <input type="hidden" name={fieldName} value={attributeValues[attr.id] ?? ""} />
                      <Checkbox
                        id={fieldName}
                        checked={attributeValues[attr.id] === "true"}
                        onCheckedChange={(checked) =>
                          handleAttributeChange(attr, checked === true ? "true" : "")
                        }
                        label={label}
                      />
                      {fieldError ? (
                        <p id={`${fieldName}-error`} className="text-xs text-text-energy">
                          {fieldError}
                        </p>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <Input
                    key={attr.id}
                    id={fieldName}
                    label={label}
                    name={fieldName}
                    required={isDetailsStep && attr.required}
                    type={config.control === "number" ? "number" : "text"}
                    value={attributeValues[attr.id] ?? ""}
                    onChange={(e) => handleAttributeChange(attr, e.target.value)}
                    min={config.min}
                    max={config.max}
                    step={config.step}
                    inputMode={config.inputMode}
                    placeholder={config.placeholder}
                    helperText={config.helperText}
                    error={fieldError}
                  />
                );
              })}
            </div>
          )}

          {fieldErrorMessages.length > 0 ? (
            <div className="rounded-md border border-neon-red-500/40 bg-neon-red-500/5 px-3 py-2">
              <p className="text-sm font-medium text-text-error">
                Please fix the following:
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-text-error">
                {fieldErrorMessages.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
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
                {mode === "dealer" || isFreeForUser
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
