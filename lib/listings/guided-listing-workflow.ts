import { isListingAttributeRequired } from "@/lib/listings/attribute-ui";
import {
  partitionByDetailGroup,
  VEHICLE_DETAIL_GROUPS,
} from "@/lib/listings/vehicle-detail-catalog";

export const GUIDED_LISTING_STEPS = [
  { step: 1, label: "Required", description: "Required vehicle details" },
  { step: 2, label: "Optional", description: "Optional vehicle details" },
  { step: 3, label: "Photos", description: "Photos" },
  { step: 4, label: "Advert", description: "Advert" },
  { step: 5, label: "Review", description: "Review" },
] as const;

export type GuidedListingStep = (typeof GUIDED_LISTING_STEPS)[number]["step"];

export const MIN_GUIDED_LISTING_PHOTOS = 2;

const ADVERT_FIELDS = new Set(["title", "description", "price", "regionId"]);
const REVIEW_FIELDS = new Set(["privateSellerTermsAccepted", "trustDeclarationAccepted"]);
const PHOTO_FIELDS = new Set(["imageId", "photos", "images"]);
const REQUIRED_FIELDS = new Set(["categoryId", "attributes"]);

const SHARED_OPTIONAL_SECTIONS = [
  {
    id: "appearance",
    title: "Body and appearance",
    slugs: ["fuel-type", "transmission", "body-type", "colour", "drive-type"],
  },
  {
    id: "capacity",
    title: "Capacity",
    slugs: ["doors", "seats", "boot-space"],
  },
  {
    id: "powertrain",
    title: "Engine and efficiency",
    slugs: [
      "engine-size",
      "engine-power",
      "battery-range",
      "charging-time",
      "acceleration",
      "fuel-consumption",
      "co2-emissions",
    ],
  },
  {
    id: "ownership",
    title: "Ownership",
    slugs: ["tax-per-year", "insurance-group", "location", "previously-written-off"],
  },
] as const;

export interface OptionalDetailSection<T> {
  id: string;
  title: string;
  items: T[];
}

export function buildOptionalDetailSections<T>(
  categorySlug: string | undefined,
  items: readonly T[],
  slugOf: (item: T) => string,
): OptionalDetailSection<T>[] {
  let pool = [...items];
  const catalogSections: OptionalDetailSection<T>[] = [];
  if (categorySlug && VEHICLE_DETAIL_GROUPS[categorySlug]) {
    const partitioned = partitionByDetailGroup(categorySlug, pool, slugOf);
    pool = partitioned.essentials;
    for (const group of partitioned.groups) {
      catalogSections.push({ id: group.id, title: group.title, items: group.items });
    }
  }

  const consumed = new Set<T>();
  const shared: OptionalDetailSection<T>[] = [];
  for (const section of SHARED_OPTIONAL_SECTIONS) {
    const slugs = new Set<string>(section.slugs);
    const matched = pool.filter((item) => slugs.has(slugOf(item)));
    if (matched.length === 0) continue;
    for (const item of matched) consumed.add(item);
    shared.push({ id: section.id, title: section.title, items: matched });
  }

  const more = pool.filter((item) => !consumed.has(item));
  if (more.length > 0) {
    shared.push({ id: "more", title: "More details", items: more });
  }

  return [...shared, ...catalogSections];
}

export function partitionGuidedAttributeFields<
  T extends { attr: { slug: string; required: boolean } },
>(
  categorySlug: string | undefined,
  fields: readonly T[],
  enforceListingNs?: boolean,
): { required: T[]; optional: T[] } {
  const required: T[] = [];
  const optional: T[] = [];
  for (const field of fields) {
    if (isListingAttributeRequired(categorySlug, field.attr, { enforceListingNs })) {
      required.push(field);
    } else {
      optional.push(field);
    }
  }
  return { required, optional };
}

export function splitGuidedAttributeErrors(
  fieldErrors: Record<string, string[]>,
  definitions: ReadonlyArray<{ id: string; slug: string; required: boolean }>,
  categorySlug: string | undefined,
  enforceListingNs?: boolean,
): { required: Record<string, string[]>; optional: Record<string, string[]> } {
  const required: Record<string, string[]> = {};
  const optional: Record<string, string[]> = {};
  if (fieldErrors.categoryId) required.categoryId = fieldErrors.categoryId;

  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (!key.startsWith("attr-")) continue;
    const definition = definitions.find((candidate) => candidate.id === key.slice(5));
    const isRequired =
      !definition ||
      isListingAttributeRequired(categorySlug, definition, { enforceListingNs });
    if (isRequired) required[key] = messages;
    else optional[key] = messages;
  }

  return { required, optional };
}

export function validateAdvertFields(input: {
  title: string;
  description: string;
  price: string;
  regionId: string;
}): { ok: true } | { ok: false; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  const title = input.title.trim();
  if (title.length < 5) fieldErrors.title = ["Title must be at least 5 characters"];
  else if (title.length > 120) fieldErrors.title = ["Title must be under 120 characters"];

  const description = input.description.trim();
  if (description.length < 20) {
    fieldErrors.description = ["Description must be at least 20 characters"];
  } else if (description.length > 5000) {
    fieldErrors.description = ["Description must be under 5,000 characters"];
  }

  const price = Number(input.price);
  if (!input.price.trim() || !Number.isFinite(price) || price < 1 || price > 1_000_000) {
    fieldErrors.price = ["Enter a price between £1 and £1,000,000."];
  }

  if (!input.regionId.trim()) fieldErrors.regionId = ["Choose a region."];

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true };
}

export function guidedStepForFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
  options?: {
    attributeSteps?: Partial<Record<string, GuidedListingStep>>;
    fallback?: GuidedListingStep;
  },
): GuidedListingStep {
  const fallback = options?.fallback ?? 1;
  let earliest: GuidedListingStep | null = null;
  for (const key of Object.keys(fieldErrors)) {
    const step = stepForFieldKey(key, options?.attributeSteps, fallback);
    if (earliest === null || step < earliest) earliest = step;
  }
  return earliest ?? fallback;
}

function stepForFieldKey(
  key: string,
  attributeSteps: Partial<Record<string, GuidedListingStep>> | undefined,
  fallback: GuidedListingStep,
): GuidedListingStep {
  if (ADVERT_FIELDS.has(key)) return 4;
  if (REVIEW_FIELDS.has(key)) return 5;
  if (PHOTO_FIELDS.has(key)) return 3;
  if (REQUIRED_FIELDS.has(key)) return 1;
  if (key.startsWith("attr-")) return attributeSteps?.[key] ?? 1;
  return fallback;
}

export function attributeStepMap(
  definitions: ReadonlyArray<{ id: string; slug: string; required: boolean }>,
  categorySlug: string | undefined,
  enforceListingNs?: boolean,
): Partial<Record<string, GuidedListingStep>> {
  const steps: Partial<Record<string, GuidedListingStep>> = {};
  for (const definition of definitions) {
    steps[`attr-${definition.id}`] = isListingAttributeRequired(categorySlug, definition, {
      enforceListingNs,
    })
      ? 1
      : 2;
  }
  return steps;
}

export type GuidedCardStatus = "current" | "complete" | "attention" | "pending";

export function guidedCardStatus(input: {
  step: GuidedListingStep;
  current: GuidedListingStep;
  complete: boolean;
  attention: boolean;
}): GuidedCardStatus {
  if (input.attention) return "attention";
  if (input.step === input.current) return "current";
  if (input.complete) return "complete";
  return "pending";
}

export function guidedStatusLabel(status: GuidedCardStatus): string {
  if (status === "current") return "Current";
  if (status === "complete") return "Done";
  if (status === "attention") return "Check";
  return "To do";
}

export function guidedNavigationBlock(input: {
  from: GuidedListingStep;
  to: GuidedListingStep;
  photoUploadsBusy: boolean;
  requiredComplete: boolean;
  optionalValid: boolean;
  photosComplete: boolean;
  advertComplete: boolean;
}): { message: string; step: GuidedListingStep } | null {
  if (input.to <= input.from) return null;
  if (input.photoUploadsBusy) {
    return {
      message: "Please wait for all photo uploads to finish before continuing.",
      step: input.from,
    };
  }
  if (!input.requiredComplete) {
    return {
      message: "Complete the required vehicle details before continuing.",
      step: 1,
    };
  }
  if (input.to > 2 && !input.optionalValid) {
    return {
      message: "Check the optional vehicle details before continuing.",
      step: 2,
    };
  }
  if (input.to > 3 && !input.photosComplete) {
    return {
      message: "Please upload at least 2 photos before continuing.",
      step: 3,
    };
  }
  if (input.to > 4 && !input.advertComplete) {
    return {
      message: "Complete the advert before review.",
      step: 4,
    };
  }
  return null;
}

export function focusIdForFieldErrors(fieldErrors: Record<string, string[]>): string | null {
  const key = Object.keys(fieldErrors).find((candidate) => candidate !== "attributes");
  if (!key) return null;
  if (key === "categoryId") return "listing-category";
  return key;
}

export function optionalSectionForAttribute(
  sections: ReadonlyArray<{ id: string; items: ReadonlyArray<{ attr: { id: string } }> }>,
  attributeId: string,
): string | null {
  return sections.find((section) => section.items.some((item) => item.attr.id === attributeId))?.id ?? null;
}
