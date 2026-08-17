import {
  isListingAttributeRequired,
  validateListingAttributes,
  type ListingAttributeDefinitionLike,
  type ListingAttributeInputLike,
} from "@/lib/listings/attribute-ui";
import { collectListingAttributes } from "./create-listing-submit";

export function validateListingDetailsStep(params: {
  selectedCategoryId: string;
  selectedCategory?: {
    slug: string;
    attributes: ListingAttributeDefinitionLike[];
  };
  attributeValues: Record<string, string>;
  enforceListingNs?: boolean;
}):
  | { ok: true; attributes: ListingAttributeInputLike[] }
  | { ok: false; fieldErrors: Record<string, string[]>; configurationError?: string } {
  if (!params.selectedCategoryId) {
    return {
      ok: false,
      fieldErrors: { categoryId: ["Please choose a category."] },
    };
  }

  if (!params.selectedCategory) {
    return { ok: true, attributes: [] };
  }

  const attributes = collectListingAttributes(
    params.selectedCategory.attributes,
    params.attributeValues,
  );
  const result = validateListingAttributes({
    categorySlug: params.selectedCategory.slug,
    definitions: params.selectedCategory.attributes,
    attributes,
    enforceListingNs: params.enforceListingNs,
  });

  if (result.configurationError) {
    return {
      ok: false,
      fieldErrors: {},
      configurationError: result.configurationError,
    };
  }

  if (Object.keys(result.fieldErrors).length > 0) {
    return { ok: false, fieldErrors: result.fieldErrors };
  }

  return { ok: true, attributes: result.sanitizedAttributes };
}

export function isDetailsAttributeRequired(
  categorySlug: string | undefined,
  attribute: Pick<ListingAttributeDefinitionLike, "required" | "slug">,
  enforceListingNs?: boolean,
) {
  return isListingAttributeRequired(categorySlug, attribute, { enforceListingNs });
}
