"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createListing,
  saveListingImages,
  submitListingForReview,
} from "@/actions/listings";
import { payForListing } from "@/actions/payments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";
import {
  getAttributeFieldConfig,
  isAttributeVisible,
  validateListingAttributes,
} from "@/lib/listings/attribute-ui";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [supportPlatform, setSupportPlatform] = useState(false);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
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
    setSelectedCategoryId(categoryId);
    setAttributeValues({});
    setFieldErrors({});
    setError(null);
  }

  function handleAttributeChange(attribute: AttributeDef, value: string) {
    setAttributeValues((currentValues) => {
      const nextValues = { ...currentValues, [attribute.id]: value };
      if (!selectedCategory) {
        return nextValues;
      }

      if (attribute.slug === "fuel-type") {
        for (const candidate of selectedCategory.attributes) {
          if (!isAttributeVisible(selectedCategory.slug, candidate.slug, value || undefined)) {
            delete nextValues[candidate.id];
          }
        }
      }

      return nextValues;
    });
  }

  function nextStep() {
    if (step === 1 && formRef.current && !formRef.current.reportValidity()) {
      return;
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
          window.location.href = payResult.data.checkoutUrl;
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
    <Card>
      <CardHeader>
        <CardTitle>
          Create Listing - Step {step} of 3
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          <div className={isDetailsStep ? "space-y-6" : "hidden"}>
              <Input
                label="Title"
                name="title"
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
                  htmlFor="categoryId"
                  className="text-sm font-medium text-text-primary"
                >
                  Category
                </label>
                <select
                  id="categoryId"
                  name="categoryId"
                  required={isDetailsStep}
                  value={selectedCategoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  aria-invalid={getFieldError("categoryId") ? true : undefined}
                  aria-describedby={getFieldError("categoryId") ? "category-error" : undefined}
                  className={`flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline ${
                    getFieldError("categoryId") ? "border-neon-red-500" : "border-border"
                  }`}
                >
                  <option value="">Select a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {getFieldError("categoryId") ? (
                  <p id="category-error" className="text-xs text-text-energy">
                    {getFieldError("categoryId")}
                  </p>
                ) : null}
              </div>

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
  );
}
