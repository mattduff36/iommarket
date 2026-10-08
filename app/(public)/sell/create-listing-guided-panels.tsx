"use client";

import { type Dispatch, type SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";
import type { ListingAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import type { OptionalDetailSection } from "@/lib/listings/guided-listing-workflow";
import type { VehicleMakeOption } from "@/lib/vehicle-catalogue/queries";
import {
  CreateListingAttributeFields,
  ListingFieldLabel,
  type ListingAttributeDef,
} from "./create-listing-attribute-fields";
import { CreateListingDeclarations } from "./create-listing-form.declarations";
import { FeaturedCheckoutOffer } from "./create-listing-featured-offer";
import {
  CATEGORY_TILE_META,
  DEFAULT_CATEGORY_TILE_ICON,
} from "./create-listing-form.constants";
import {
  VehicleCatalogueFields,
  type VehicleCatalogueSelection,
} from "./vehicle-catalogue-fields";

export interface GuidedAttributeField {
  attr: ListingAttributeDef;
  config: ListingAttributeFieldConfig;
}

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface RegionOption {
  id: string;
  name: string;
}

export function GuidedListingStepPanels({
  step,
  categories,
  regions,
  selectedCategoryId,
  selectedCategoryName,
  selectedCategorySlug,
  onCategoryChange,
  registrationInput,
  onRegistrationInput,
  onRegistrationBlur,
  lookupPending,
  lookupError,
  lookupMeta,
  onLookup,
  isLookupCategorySupported,
  hasSelectedCategory,
  titleValue,
  onTitleChange,
  descriptionValue,
  onDescriptionChange,
  priceValue,
  onPriceChange,
  regionId,
  onRegionChange,
  requiredFields,
  optionalSections,
  activeOptionalSectionId,
  onOptionalSectionChange,
  attributeValues,
  enforceListingNs,
  getFieldError,
  onAttributeChange,
  isVehicleCatalogueCategory,
  makeAttribute,
  modelAttribute,
  vehicleMakes,
  onCatalogueChange,
  onCatalogueSelectionChange,
  maxImages,
  uploadedImages,
  onImagesChange,
  onPhotoBusyChange,
  mode,
  isFreeForUser,
  showFeaturedOffer,
  listingFeePence,
  featuredUpgradePricePence,
  listingFeeDue,
  includeFeatured,
  onIncludeFeaturedChange,
  trustConfirmed,
  trustConfirmationMissing,
  privateSellerTermsAccepted,
  privateSellerTermsMissing,
  onTrustChange,
  onPrivateTermsChange,
  onEditStep,
  revisionLocked,
}: {
  step: number;
  categories: CategoryOption[];
  regions: RegionOption[];
  selectedCategoryId: string;
  selectedCategoryName?: string;
  selectedCategorySlug?: string;
  onCategoryChange: (categoryId: string) => void;
  registrationInput: string;
  onRegistrationInput: (value: string) => void;
  onRegistrationBlur: () => void;
  lookupPending: boolean;
  lookupError: string | null;
  lookupMeta: string | null;
  onLookup: () => void;
  isLookupCategorySupported: boolean;
  hasSelectedCategory: boolean;
  titleValue: string;
  onTitleChange: (value: string) => void;
  descriptionValue: string;
  onDescriptionChange: (value: string) => void;
  priceValue: string;
  onPriceChange: (value: string) => void;
  regionId: string;
  onRegionChange: (value: string) => void;
  requiredFields: GuidedAttributeField[];
  optionalSections: OptionalDetailSection<GuidedAttributeField>[];
  activeOptionalSectionId: string | null;
  onOptionalSectionChange: (sectionId: string) => void;
  attributeValues: Record<string, string>;
  enforceListingNs?: boolean;
  getFieldError: (fieldName: string) => string | undefined;
  onAttributeChange: (attribute: ListingAttributeDef, value: string) => void;
  isVehicleCatalogueCategory: boolean;
  makeAttribute?: ListingAttributeDef;
  modelAttribute?: ListingAttributeDef;
  vehicleMakes: VehicleMakeOption[];
  onCatalogueChange: (attributeId: string, value: string) => void;
  onCatalogueSelectionChange: (selection: VehicleCatalogueSelection) => void;
  maxImages: number;
  uploadedImages: UploadedImage[];
  onImagesChange: Dispatch<SetStateAction<UploadedImage[]>>;
  onPhotoBusyChange: (busy: boolean) => void;
  mode: "private" | "dealer";
  isFreeForUser: boolean;
  showFeaturedOffer: boolean;
  listingFeePence?: number;
  featuredUpgradePricePence?: number;
  listingFeeDue: boolean;
  includeFeatured: boolean;
  onIncludeFeaturedChange: (include: boolean) => void;
  trustConfirmed: boolean;
  trustConfirmationMissing: boolean;
  privateSellerTermsAccepted: boolean;
  privateSellerTermsMissing: boolean;
  onTrustChange: (accepted: boolean) => void;
  onPrivateTermsChange: (accepted: boolean) => void;
  onEditStep: (step: 1 | 2 | 3 | 4) => void;
  revisionLocked: boolean;
}) {
  const regionName = regions.find((region) => region.id === regionId)?.name ?? "";
  const requiredSummary = [
    selectedCategoryName,
    ...(isVehicleCatalogueCategory ? [makeAttribute, modelAttribute] : [])
      .filter((attribute) => attribute !== undefined)
      .map((attribute) => {
        const value = attributeValues[attribute.id]?.trim();
        return value ? `${attribute.name}: ${value}` : "";
      }),
    summariseAttributes(requiredFields, attributeValues),
  ].filter(Boolean).join("\n");
  const optionalSummary = summariseAttributes(
    optionalSections.flatMap((section) => section.items),
    attributeValues,
  );

  return (
    <>
      <div data-listing-step="1" hidden={step !== 1} className={step === 1 ? "space-y-6" : "hidden"}>
        <div id="listing-category" className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-text-primary">Category</h3>
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
                  onClick={() => onCategoryChange(category.id)}
                  className={[
                    "h-16 w-full flex-col gap-1 whitespace-normal rounded-md border text-[11px] leading-tight sm:text-xs",
                    "font-semibold normal-case not-italic",
                    isSelected
                      ? (meta?.selectedClass ??
                        "border-neon-blue-400 bg-neon-blue-500/15 text-white ring-2 ring-neon-blue-500/70")
                      : "border-border bg-surface/40 text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                  ].join(" ")}
                  leftIcon={
                    <Icon
                      className={`h-4 w-4 ${isSelected ? "text-white" : (meta?.idleIconClass ?? "text-neon-blue-400")}`}
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
          <h3 className="text-sm font-semibold text-text-primary">Number Plate Lookup</h3>
          <p className="text-xs text-text-secondary">
            Enter a UK or Isle of Man plate to auto-fill available vehicle details.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              label="Number Plate"
              value={registrationInput}
              onChange={(event) => onRegistrationInput(event.target.value)}
              onBlur={onRegistrationBlur}
              placeholder="e.g. AB12 CDE or MAN 123"
            />
            <Button type="button" onClick={onLookup} loading={lookupPending} disabled={lookupPending}>
              Lookup Vehicle
            </Button>
          </div>
          {!hasSelectedCategory ? (
            <p className="text-xs text-text-secondary">
              If category is empty, lookup will try to auto-select one from returned data.
            </p>
          ) : !isLookupCategorySupported ? (
            <p className="text-xs text-text-secondary">
              Lookup is available for car, van, motorbike, and motorhome categories.
            </p>
          ) : null}
          {lookupError ? <p className="text-xs text-text-error">{lookupError}</p> : null}
          {lookupMeta ? <p className="text-xs text-text-secondary">{lookupMeta}</p> : null}
        </div>

        {hasSelectedCategory && (requiredFields.length > 0 || isVehicleCatalogueCategory) ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-text-primary">
              {selectedCategoryName} details
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
                required={step === 1}
                onChange={onCatalogueChange}
                onSelectionChange={onCatalogueSelectionChange}
              />
            ) : null}
            {selectedCategorySlug ? (
              <CreateListingAttributeFields
                layout="plain"
                categorySlug={selectedCategorySlug}
                visibleAttributes={requiredFields}
                attributeValues={attributeValues}
                isDetailsStep={step === 1}
                enforceListingNs={enforceListingNs}
                getFieldError={getFieldError}
                onAttributeChange={onAttributeChange}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div data-listing-step="2" hidden={step !== 2} className={step === 2 ? "space-y-4" : "hidden"}>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text-primary">Optional vehicle details</h3>
          <p className="text-xs text-text-secondary">
            Optional. You can continue without these. Leave a field blank to clear it. Unknown is not the same as No.
          </p>
        </div>
        {optionalSections.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Optional detail groups">
            {optionalSections.map((section) => {
              const selected = section.id === activeOptionalSectionId;
              return (
                <Button
                  key={section.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={selected}
                  className={
                    selected
                      ? "h-auto whitespace-normal border border-neon-blue-400 bg-neon-blue-500/15 text-text-primary"
                      : "h-auto whitespace-normal border border-border"
                  }
                  onClick={() => onOptionalSectionChange(section.id)}
                >
                  {section.title}
                </Button>
              );
            })}
          </div>
        ) : null}
        {selectedCategorySlug
          ? optionalSections.map((section) => {
              const active = section.id === activeOptionalSectionId;
              return (
                <div key={section.id} hidden={!active} className={active ? "space-y-4" : "hidden"}>
                  <h4 className="text-sm font-semibold text-text-primary">{section.title}</h4>
                  <CreateListingAttributeFields
                    layout="plain"
                    categorySlug={selectedCategorySlug}
                    visibleAttributes={section.items}
                    attributeValues={attributeValues}
                    isDetailsStep={false}
                    enforceListingNs={enforceListingNs}
                    getFieldError={getFieldError}
                    onAttributeChange={onAttributeChange}
                  />
                </div>
              );
            })
          : (
            <p className="text-sm text-text-secondary">Choose a category before adding optional details.</p>
          )}
      </div>

      <div data-listing-step="3" hidden={step !== 3} className={step === 3 ? "space-y-3" : "hidden"}>
        <p className="text-sm text-text-secondary">
          Add between 2 and {maxImages} photos. Use a clean first image and include exterior and interior shots.
        </p>
        <ImageUpload
          images={uploadedImages}
          onImagesChange={onImagesChange}
          onBusyChange={onPhotoBusyChange}
          maxImages={maxImages}
        />
      </div>

      <div data-listing-step="4" hidden={step !== 4} className={step === 4 ? "space-y-4" : "hidden"}>
        <h3 className="text-sm font-semibold text-text-primary">Advert</h3>
        <Input
          id="title"
          label="Title"
          name="title"
          value={titleValue}
          onChange={(event) => onTitleChange(event.target.value)}
          required={step === 4}
          minLength={5}
          maxLength={120}
          placeholder="e.g. 2019 BMW 320d M Sport"
          error={getFieldError("title")}
        />
        <Input
          id="price"
          label="Price (£)"
          name="price"
          type="number"
          value={priceValue}
          onChange={(event) => onPriceChange(event.target.value)}
          required={step === 4}
          min={1}
          max={1000000}
          step={0.01}
          inputMode="decimal"
          placeholder="e.g. 15000"
          error={getFieldError("price")}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="regionId" className="text-sm font-medium text-text-primary">
            <ListingFieldLabel label="Region" required={step === 4} />
          </label>
          <select
            id="regionId"
            name="regionId"
            required={step === 4}
            value={regionId}
            onChange={(event) => onRegionChange(event.target.value)}
            aria-invalid={getFieldError("regionId") ? true : undefined}
            aria-describedby={getFieldError("regionId") ? "region-error" : undefined}
            className={`flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline ${
              getFieldError("regionId") ? "border-neon-red-500" : "border-border"
            }`}
          >
            <option value="">Select a region</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
          {getFieldError("regionId") ? (
            <p id="region-error" className="text-xs text-text-energy">
              {getFieldError("regionId")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-text-primary">
            <ListingFieldLabel label="Description" required={step === 4} />
          </label>
          <textarea
            id="description"
            name="description"
            value={descriptionValue}
            onChange={(event) => onDescriptionChange(event.target.value)}
            required={step === 4}
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
      </div>

      <div data-listing-step="5" hidden={step !== 5} className={step === 5 ? "space-y-3" : "hidden"}>
        <h3 className="text-base font-semibold text-text-primary">Review</h3>
        <p className="text-sm text-text-secondary">
          {mode === "dealer" || isFreeForUser
            ? "Review your listing and submit. Your listing will go to moderation once submitted."
            : "Review your listing and continue to checkout. Your listing will be submitted for moderation after payment."}
        </p>
        {revisionLocked ? (
          <p className="text-sm text-text-secondary">
            Your changes are awaiting review and cannot be edited yet.
          </p>
        ) : null}
        <ReviewRow
          label="Required details"
          value={requiredSummary || selectedCategoryName || "No required details yet."}
          action="Edit required details"
          onEdit={() => onEditStep(1)}
        />
        <ReviewRow
          label="Optional details"
          value={optionalSummary || "No optional details added."}
          action="Edit optional details"
          onEdit={() => onEditStep(2)}
        />
        <ReviewRow
          label="Photos"
          value={
            uploadedImages.length > 0
              ? `Photos selected: ${uploadedImages.length}`
              : "No photos selected."
          }
          action="Edit photos"
          onEdit={() => onEditStep(3)}
        />
        {uploadedImages.length > 0 ? (
          <p className="text-sm text-text-secondary">The first photo is the cover.</p>
        ) : null}
        <ReviewRow
          label="Advert"
          value={[
            titleValue.trim() || "No title",
            priceValue.trim() ? `£${priceValue}` : "No price",
            regionName || "No region",
          ].join(" · ")}
          action="Edit advert"
          onEdit={() => onEditStep(4)}
        />
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs text-text-secondary">Description</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEditStep(4)}>
              Edit description
            </Button>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
            {descriptionValue.trim() || "No description yet."}
          </p>
        </div>
        {showFeaturedOffer &&
        typeof listingFeePence === "number" &&
        typeof featuredUpgradePricePence === "number" ? (
          <FeaturedCheckoutOffer
            listingFeePence={listingFeePence}
            featuredUpgradePricePence={featuredUpgradePricePence}
            listingFeeDue={listingFeeDue}
            includeFeatured={includeFeatured}
            onIncludeFeaturedChange={onIncludeFeaturedChange}
          />
        ) : null}
        <CreateListingDeclarations
          mode={mode}
          step={step}
          trustConfirmed={trustConfirmed}
          trustConfirmationMissing={trustConfirmationMissing}
          privateSellerTermsAccepted={privateSellerTermsAccepted}
          privateSellerTermsMissing={privateSellerTermsMissing}
          onTrustChange={onTrustChange}
          onPrivateTermsChange={onPrivateTermsChange}
        />
      </div>
    </>
  );
}

function ReviewRow({
  label,
  value,
  action,
  onEdit,
}: {
  label: string;
  value: string;
  action: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{value}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" className="shrink-0 whitespace-normal" onClick={onEdit}>
        {action}
      </Button>
    </div>
  );
}

function summariseAttributes(
  fields: GuidedAttributeField[],
  attributeValues: Record<string, string>,
): string {
  return fields
    .map((field) => {
      const value = attributeValues[field.attr.id]?.trim() ?? "";
      if (!value) return "";
      return `${field.attr.name}: ${value}`;
    })
    .filter(Boolean)
    .join("\n");
}
