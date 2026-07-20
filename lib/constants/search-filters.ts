/**
 * Shared vehicle-search options and numeric range boundaries.
 * URL/search values continue to use their real units.
 */

export { FUEL_TYPE_OPTIONS } from "@/lib/constants/fuel-types";

export const PRICE_MIN = 1_000;
export const PRICE_MAX = 250_000;
export const PRICE_STEP = 500;
export const MILEAGE_MIN = 0;
export const MILEAGE_MAX = 200_000;
export const MILEAGE_STEP = 5_000;
export const YEAR_MIN = 1920;
export const FUEL_CONSUMPTION_MIN = 0;
export const FUEL_CONSUMPTION_MAX = 150;
export const TAX_MIN = 0;
export const TAX_MAX = 750;

export const BODY_TYPE_OPTIONS = [
  "Hatchback", "Saloon", "SUV", "Estate", "Coupe",
  "Convertible", "MPV", "Pickup",
] as const;

export const COLOUR_OPTIONS = [
  "Black", "White", "Silver", "Grey", "Blue", "Red",
  "Green", "Yellow", "Orange", "Brown", "Gold", "Bronze", "Other",
] as const;

export const TRANSMISSION_OPTIONS = ["Manual", "Automatic"] as const;

export const DRIVE_TYPE_OPTIONS = ["FWD", "RWD", "4WD", "AWD"] as const;

export const SELLER_TYPE_OPTIONS = [
  { label: "Any", value: "" },
  { label: "Private", value: "private" },
  { label: "Dealer", value: "dealer" },
] as const;

export const DOORS_OPTIONS = [2, 3, 4, 5] as const;
export const SEATS_OPTIONS = [2, 4, 5, 6, 7, 8, 9] as const;

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

function parseBoundedInteger(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue)) return fallback;
  return Math.min(max, Math.max(min, parsedValue));
}

export function parseOptionalBoundedInteger(
  value: string | null | undefined,
  min: number,
  max: number,
): number | undefined {
  if (!value) return undefined;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue)) return undefined;
  return Math.min(max, Math.max(min, parsedValue));
}

export function parseBoundedRange(
  minValue: string | null | undefined,
  maxValue: string | null | undefined,
  min: number,
  max: number,
): [number, number] {
  const parsedMin = parseBoundedInteger(minValue, min, min, max);
  const parsedMax = parseBoundedInteger(maxValue, max, min, max);
  return parsedMin <= parsedMax ? [parsedMin, parsedMax] : [min, max];
}

export function parseYearRange(
  minYear: string | undefined,
  maxYear: string | undefined,
): [number, number] {
  return parseBoundedRange(minYear, maxYear, YEAR_MIN, getCurrentYear());
}
