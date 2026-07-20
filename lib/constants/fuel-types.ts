import { z } from "zod";

export const FUEL_TYPE_OPTIONS = [
  "Petrol",
  "Diesel",
  "Electric",
  "Petrol Hybrid",
  "Diesel Hybrid",
  "Petrol Plug-in Hybrid",
  "Diesel Plug-in Hybrid",
] as const;

export type FuelType = (typeof FUEL_TYPE_OPTIONS)[number];

export const fuelTypeSchema = z.enum(FUEL_TYPE_OPTIONS);

export const LEGACY_FUEL_TYPE_VALUES = ["Hybrid", "Plug-in Hybrid"] as const;
export const LEGACY_FUEL_TYPE_FILTER_VALUE = "other-legacy";

export const FUEL_TYPE_FILTER_OPTIONS = [
  ...FUEL_TYPE_OPTIONS.map((fuelType) => ({ label: fuelType, value: fuelType })),
  {
    label: "Other / legacy fuel type",
    value: LEGACY_FUEL_TYPE_FILTER_VALUE,
  },
] as const;

export const fuelTypeFilterSchema = z.enum([
  ...FUEL_TYPE_OPTIONS,
  LEGACY_FUEL_TYPE_FILTER_VALUE,
]);

export type FuelTypeFilter = z.infer<typeof fuelTypeFilterSchema>;

const EV_COMPATIBLE_FUEL_TYPES = new Set<FuelType>([
  "Electric",
  "Petrol Plug-in Hybrid",
  "Diesel Plug-in Hybrid",
]);

export function parseFuelTypeFilter(value: string | null | undefined): FuelTypeFilter | undefined {
  const result = fuelTypeFilterSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function getFuelTypeFilterValues(value: FuelTypeFilter): readonly string[] {
  return value === LEGACY_FUEL_TYPE_FILTER_VALUE ? LEGACY_FUEL_TYPE_VALUES : [value];
}

export function isEvCompatibleFuelType(value: string | null | undefined): boolean {
  const result = fuelTypeSchema.safeParse(value);
  return result.success && EV_COMPATIBLE_FUEL_TYPES.has(result.data);
}
