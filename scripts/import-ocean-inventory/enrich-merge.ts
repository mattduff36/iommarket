import type { ListingAttributeDefinitionLike } from "../../lib/listings/attribute-ui";
import { mapVehicleResultToListingAttributes } from "../../lib/listings/vehicle-autofill";
import type { VehicleCheckResult } from "../../lib/services/vehicle-check-types";
import {
  ENRICH_APPROVED_SLUGS,
  type EnrichApprovedSlug,
} from "./enrich-types";

export function isBlankAttribute(value: string | null | undefined) {
  return value == null || value.trim() === "";
}

export function lookupValuesBySlug(input: {
  definitions: ListingAttributeDefinitionLike[];
  result: VehicleCheckResult;
}): Partial<Record<EnrichApprovedSlug, string>> {
  const mapped = mapVehicleResultToListingAttributes({
    definitions: input.definitions,
    result: input.result,
  });
  const bySlug: Partial<Record<EnrichApprovedSlug, string>> = {};
  const approved = new Set<string>(ENRICH_APPROVED_SLUGS);
  for (const definition of input.definitions) {
    if (!approved.has(definition.slug)) continue;
    const value = mapped.values[definition.id];
    if (!value || isBlankAttribute(value)) continue;
    bySlug[definition.slug as EnrichApprovedSlug] = value;
  }
  return bySlug;
}

export function mergeEmptyAttributes(input: {
  current: Record<string, string>;
  lookupBySlug: Partial<Record<EnrichApprovedSlug, string>>;
}) {
  const fills: Partial<Record<EnrichApprovedSlug, string>> = {};
  const preserved: EnrichApprovedSlug[] = [];
  for (const slug of ENRICH_APPROVED_SLUGS) {
    const nextValue = input.lookupBySlug[slug];
    if (!nextValue) continue;
    if (!isBlankAttribute(input.current[slug])) {
      preserved.push(slug);
      continue;
    }
    fills[slug] = nextValue;
  }
  return { fills, preserved };
}
