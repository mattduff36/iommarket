import {
  bodyTypePresentation,
  vehicleDetailAttributes,
} from "../../lib/listings/vehicle-detail-catalog";
import { MOTORBIKE_EXCLUDED_ATTRS, VEHICLE_ATTRIBUTE_DEFS } from "./catalog";

export interface CatalogAttributeSeed {
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  sortOrder: number;
  options: string | null;
}

export function carBodyTypeOptions(): string[] {
  const bodyType = VEHICLE_ATTRIBUTE_DEFS.find((attribute) => attribute.slug === "body-type");
  if (!bodyType || !("options" in bodyType)) return [];
  const parsed = JSON.parse(bodyType.options) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((option): option is string => typeof option === "string")
    : [];
}

export function attributeDefsForCategory(categorySlug: string): CatalogAttributeSeed[] {
  const excluded =
    categorySlug === "motorbike" ? new Set<string>(MOTORBIKE_EXCLUDED_ATTRS) : null;
  const bodyType = bodyTypePresentation(categorySlug);
  const shared = VEHICLE_ATTRIBUTE_DEFS.filter(
    (attribute) => !excluded?.has(attribute.slug),
  ).map((attribute) => {
    const options = "options" in attribute ? attribute.options : null;
    if (attribute.slug === "body-type" && bodyType) {
      return {
        name: bodyType.name,
        slug: attribute.slug,
        dataType: attribute.dataType,
        required: attribute.required,
        sortOrder: attribute.sortOrder,
        options: JSON.stringify(bodyType.options),
      };
    }
    return {
      name: attribute.name,
      slug: attribute.slug,
      dataType: attribute.dataType,
      required: attribute.required,
      sortOrder: attribute.sortOrder,
      options,
    };
  });

  const details = vehicleDetailAttributes(categorySlug).map((attribute) => ({
    name: attribute.name,
    slug: attribute.slug,
    dataType: attribute.dataType,
    required: false,
    sortOrder: attribute.sortOrder,
    options: attribute.options ? JSON.stringify(attribute.options) : null,
  }));

  return [...shared, ...details];
}
