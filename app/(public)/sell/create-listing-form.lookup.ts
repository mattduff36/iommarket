import type { ListingAttributeDefinitionLike } from "@/lib/listings/attribute-ui";
import { mapVehicleResultToListingAttributes } from "@/lib/listings/vehicle-autofill";
import type { VehicleCheckResponse } from "@/lib/services/vehicle-check-types";
import { formatRegistrationForDisplay } from "@/lib/utils/registration";
import {
  buildSuggestedListingTitle,
  extractLookupErrorMessage,
  inferCategoryFromLookupResult,
  pruneHiddenAttributes,
  REGISTRATION_LOOKUP_CATEGORY_SLUGS,
} from "./create-listing-form.helpers";

type LookupCategory = {
  id: string;
  name: string;
  slug: string;
  attributes: ListingAttributeDefinitionLike[];
};

export async function runVehicleLookup(params: {
  selectedCategory: LookupCategory | undefined;
  isLookupCategorySupported: boolean;
  registrationInput: string;
  titleValue: string;
  categories: LookupCategory[];
}): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      registrationInput: string;
      titleValue?: string;
      selectedCategoryId?: string;
      attributeValues: Record<string, string>;
      appliedAttributeIds: string[];
      clearTitleError: boolean;
      meta: string;
    }
> {
  if (params.selectedCategory && !params.isLookupCategorySupported) {
    return {
      ok: false,
      error:
        "Vehicle lookup is available for car, van, motorbike, and motorhome listings.",
    };
  }

  const submittedRegistration = params.registrationInput.trim();
  if (!submittedRegistration) {
    return { ok: false, error: "Enter a number plate to run the lookup." };
  }

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
      return { ok: false, error: extractLookupErrorMessage(payload) };
    }
    const lookupPayload = payload as VehicleCheckResponse;

    let activeCategory = params.selectedCategory;
    let autoSelectedCategoryName: string | null = null;
    if (!activeCategory) {
      const inferredCategory = inferCategoryFromLookupResult(
        lookupPayload.result,
        params.categories,
      );
      if (!inferredCategory) {
        return {
          ok: false,
          error:
            "Could not auto-select a category from the lookup result. Please choose a category and try again.",
        };
      }
      activeCategory = inferredCategory;
      autoSelectedCategoryName = inferredCategory.name;
    }

    if (!REGISTRATION_LOOKUP_CATEGORY_SLUGS.has(activeCategory.slug)) {
      return {
        ok: false,
        error:
          "Vehicle lookup is available for car, van, motorbike, and motorhome listings.",
      };
    }

    const mapped = mapVehicleResultToListingAttributes({
      definitions: activeCategory.attributes,
      result: lookupPayload.result,
    });

    const yearDefinition = activeCategory.attributes.find(
      (attribute) => attribute.slug === "year",
    );
    const makeDefinition = activeCategory.attributes.find(
      (attribute) => attribute.slug === "make",
    );
    const modelDefinition = activeCategory.attributes.find(
      (attribute) => attribute.slug === "model",
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
    const didSuggestTitle = Boolean(suggestedTitle && !params.titleValue.trim());

    if (mapped.appliedAttributeIds.length === 0 && !didSuggestTitle) {
      return {
        ok: true,
        registrationInput: formatRegistrationForDisplay(submittedRegistration),
        selectedCategoryId: autoSelectedCategoryName ? activeCategory.id : undefined,
        attributeValues: {},
        appliedAttributeIds: [],
        clearTitleError: false,
        meta: "Vehicle found, but no matching listing fields were available to auto-fill.",
      };
    }

    const statusMessages: string[] = [];
    if (autoSelectedCategoryName) {
      statusMessages.push(`Category auto-selected: ${autoSelectedCategoryName}`);
    }
    if (mapped.appliedAttributeIds.length > 0) {
      statusMessages.push(
        `Auto-filled ${mapped.appliedAttributeIds.length} field${mapped.appliedAttributeIds.length === 1 ? "" : "s"} from registration data`,
      );
    }
    if (didSuggestTitle) {
      statusMessages.push("Suggested a listing title");
    }
    const warningSuffix = lookupPayload.result.warnings.length
      ? ` (${lookupPayload.result.warnings.length} warning${lookupPayload.result.warnings.length === 1 ? "" : "s"} reported in lookup data).`
      : ".";

    return {
      ok: true,
      registrationInput: formatRegistrationForDisplay(submittedRegistration),
      titleValue: didSuggestTitle && suggestedTitle ? suggestedTitle : undefined,
      selectedCategoryId: autoSelectedCategoryName ? activeCategory.id : undefined,
      attributeValues: pruneHiddenAttributes(mapped.values, activeCategory),
      appliedAttributeIds: mapped.appliedAttributeIds,
      clearTitleError: didSuggestTitle,
      meta: `${statusMessages.join(". ")}. Please review before submitting${warningSuffix}`,
    };
  } catch {
    return { ok: false, error: "Vehicle lookup failed. Please try again." };
  }
}
