import { isAttributeVisible } from "@/lib/listings/attribute-ui";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

export const REGISTRATION_LOOKUP_CATEGORY_SLUGS = new Set([
  "car",
  "van",
  "motorbike",
  "motorhome",
]);

export function extractLookupErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Vehicle lookup failed. Please try again.";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const firstValue = Object.values(record.error)[0];
    if (typeof firstValue === "string") {
      return firstValue;
    }
    if (Array.isArray(firstValue) && typeof firstValue[0] === "string") {
      return firstValue[0];
    }
  }

  return "Vehicle lookup failed. Please try again.";
}

export function inferCategorySlugFromLookupResult(
  result: VehicleCheckResult
): string | null {
  const hints = [
    result.vehicle?.category,
    result.vehicle?.wheelPlan,
    result.vehicle?.model,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toUpperCase();

  if (!hints) return null;

  if (
    /\b(MOTORHOME|MOTOR\s*HOME|MOTORCARAVAN|MOTOR\s*CARAVAN|CAMPER|CAMPERVAN|CARAVAN)\b/.test(
      hints
    )
  ) {
    return "motorhome";
  }

  if (
    /\b(MOTORBIKE|MOTORCYCLE|MOTOR\s*CYCLE|2[-\s]?WHEEL|BIKE)\b/.test(hints)
  ) {
    return "motorbike";
  }

  if (
    /\b(PANEL\s*VAN|LIGHT\s*GOODS|LGV|PICK\s*UP|PICKUP|VAN|TRUCK|LORRY)\b/.test(
      hints
    )
  ) {
    return "van";
  }

  if (
    /\b(HATCHBACK|SALOON|ESTATE|COUPE|CONVERTIBLE|SUV|MPV|CAR)\b/.test(hints)
  ) {
    return "car";
  }

  return null;
}

export function inferCategoryFromLookupResult<T extends { slug: string }>(
  result: VehicleCheckResult,
  categories: T[]
): T | null {
  const inferredSlug = inferCategorySlugFromLookupResult(result);
  if (!inferredSlug) return null;
  return categories.find((category) => category.slug === inferredSlug) ?? null;
}

function normalizeTitleToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function buildSuggestedListingTitle(params: {
  year: string | null;
  make: string | null;
  model: string | null;
}): string | null {
  const year = normalizeTitleToken(params.year);
  const make = normalizeTitleToken(params.make);
  const model = normalizeTitleToken(params.model);

  const parts = [year, make, model].filter(
    (part): part is string => Boolean(part)
  );
  if (parts.length === 0) {
    return null;
  }

  const title = parts.join(" ").slice(0, 120).trim();
  return title.length > 0 ? title : null;
}

export function pruneHiddenAttributes<T extends { id: string; slug: string }>(
  values: Record<string, string>,
  category: { slug: string; attributes: T[] }
) {
  const nextValues = { ...values };
  const fuelTypeDef = category.attributes.find(
    (attribute) => attribute.slug === "fuel-type"
  );
  const fuelType = fuelTypeDef ? nextValues[fuelTypeDef.id] : undefined;

  for (const candidate of category.attributes) {
    if (!isAttributeVisible(category.slug, candidate.slug, fuelType || undefined)) {
      delete nextValues[candidate.id];
    }
  }

  return nextValues;
}
