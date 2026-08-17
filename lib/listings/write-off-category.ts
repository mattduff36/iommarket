export const WRITE_OFF_CATEGORY_SLUG = "write-off-category";
export const WRITE_OFF_CATEGORY_VALUES = ["None", "Category N", "Category S"] as const;

export type WriteOffCategoryValue = (typeof WRITE_OFF_CATEGORY_VALUES)[number];

export function isWriteOffCategoryValue(
  value: string | null | undefined,
): value is WriteOffCategoryValue {
  return WRITE_OFF_CATEGORY_VALUES.includes(value as WriteOffCategoryValue);
}

export function isDisclosedWriteOff(value: string | null | undefined) {
  return value === "Category N" || value === "Category S";
}

export function findWriteOffCategory(
  attributes: Array<{ slug?: string; name?: string; value: string }>,
) {
  return (
    attributes.find((attribute) => attribute.slug === WRITE_OFF_CATEGORY_SLUG)?.value ??
    null
  );
}

export function writeOffFromAttributeValues(
  values: Array<{ value: string; attributeDefinition?: { slug?: string } | null }>,
) {
  return (
    values.find(
      (value) => value.attributeDefinition?.slug === WRITE_OFF_CATEGORY_SLUG,
    )?.value ?? null
  );
}

export const WRITE_OFF_ATTRIBUTE_INCLUDE = {
  where: { attributeDefinition: { slug: WRITE_OFF_CATEGORY_SLUG } },
  select: {
    value: true,
    attributeDefinition: { select: { slug: true } },
  },
} as const;

export const WRITE_OFF_SUBMIT_ERROR =
  "Choose None, Category N, or Category S before submitting this listing.";

export const WRITE_OFF_CONFIG_ERROR =
  "Write-off category is not configured for this vehicle category.";

export const LISTING_DECLARATION_LABEL =
  "I confirm I have authority to advertise this vehicle, the listing is accurate, it is not a prohibited vehicle, I have rights to the photos, any Category N or S write-off is disclosed, and it is not stolen and has no outstanding finance";

export const LISTING_DECLARATION_ERROR =
  "Please confirm the listing declarations before submitting.";
