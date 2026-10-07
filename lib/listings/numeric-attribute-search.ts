import { Prisma } from "@prisma/client";
import {
  CHARGING_TIME_MAX_HOURS,
  ENGINE_SIZE_MAX_LITRES,
} from "@/lib/search/numeric-filter-units";

export type NumericAttributeRange = {
  slug: string;
  min?: number;
  max?: number;
};

/**
 * Trimmed stored text that Postgres can cast to numeric without throwing.
 * POSIX syntax: no non-capturing groups. Blank text and anything else stay null.
 */
export const STORED_DECIMAL_PATTERN = String.raw`^-?[0-9]{1,9}(\.[0-9]{1,6})?$|^-?\.[0-9]{1,6}$`;

const OPEN_NUMERIC_MAX = 999999999;

export const NUMERIC_ATTRIBUTE_FILTER_LIMITS = {
  mileage: { min: 0, max: 200000, decimal: false },
  year: { min: 1920, max: 9999, decimal: false },
  "engine-size": { min: 0, max: ENGINE_SIZE_MAX_LITRES, decimal: true },
  "engine-power": { min: 0, max: 3000, decimal: false },
  "battery-range": { min: 0, max: 2000, decimal: false },
  "charging-time": { min: 0, max: CHARGING_TIME_MAX_HOURS, decimal: true },
  acceleration: { min: 0, max: 60, decimal: true },
  "co2-emissions": { min: 0, max: 1000, decimal: false },
  "fuel-consumption": { min: 0, max: 150, decimal: false },
  "tax-per-year": { min: 0, max: 750, decimal: false },
  "insurance-group": { min: 1, max: 50, decimal: false },
  "boot-space": { min: 0, max: 10000, decimal: false },
  doors: { min: 1, max: 6, decimal: false },
  seats: { min: 1, max: 12, decimal: false },
} as const;

export function parseNumericAttributeBound(
  input: string | null | undefined,
  slug: keyof typeof NUMERIC_ATTRIBUTE_FILTER_LIMITS,
): number | undefined {
  if (input == null || input.trim() === "") return undefined;
  const limits = NUMERIC_ATTRIBUTE_FILTER_LIMITS[slug];
  const pattern = limits.decimal ? /^(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})$/u : /^\d{1,6}$/u;
  const text = input.trim();
  if (!pattern.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < limits.min || value > limits.max) return undefined;
  return value;
}

/**
 * CASE evaluates only the matching branch, so a malformed value is null
 * instead of aborting the search. The pattern is bound, not concatenated.
 */
export function storedDecimalSql(valueSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE WHEN btrim(${valueSql}) ~ ${STORED_DECIMAL_PATTERN} THEN btrim(${valueSql})::numeric ELSE NULL END`;
}

/**
 * Numeric attribute filters need a cast Prisma's query builder will not emit.
 * Table names match the unmapped Prisma models. This query only returns ids;
 * callers must AND those ids with marketplace visibility.
 */
export function numericAttributeListingIdQuery(
  filters: readonly NumericAttributeRange[],
): Prisma.Sql {
  if (filters.length === 0) {
    throw new Error("numericAttributeListingIdQuery requires at least one filter");
  }

  for (const filter of filters) {
    const limits = NUMERIC_ATTRIBUTE_FILTER_LIMITS[filter.slug as keyof typeof NUMERIC_ATTRIBUTE_FILTER_LIMITS];
    const min = filter.min ?? limits?.min;
    const max = filter.max ?? limits?.max;
    if (
      !limits
      || (filter.min === undefined && filter.max === undefined)
      || min === undefined || max === undefined
      || !Number.isFinite(min) || !Number.isFinite(max)
      || min < 0 || min > OPEN_NUMERIC_MAX || max > OPEN_NUMERIC_MAX
      || (!limits.decimal && (!Number.isInteger(min) || !Number.isInteger(max)))
    ) {
      throw new Error("Numeric attribute filter bounds are invalid");
    }
  }

  const conditions = filters.map((filter) => {
    const limits = NUMERIC_ATTRIBUTE_FILTER_LIMITS[filter.slug as keyof typeof NUMERIC_ATTRIBUTE_FILTER_LIMITS];
    if (!limits) throw new Error("Numeric attribute filter slug is invalid");
    const min = filter.min ?? 0;
    const max = filter.max ?? OPEN_NUMERIC_MAX;
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ListingAttributeValue" lav
      INNER JOIN "AttributeDefinition" ad ON ad.id = lav."attributeDefinitionId"
      WHERE lav."listingId" = l.id
        AND ad.slug = ${filter.slug}
        AND ${storedDecimalSql(Prisma.sql`lav.value`)} BETWEEN CAST(${min} AS numeric) AND CAST(${max} AS numeric)
    )`;
  });

  let combined = conditions[0];
  for (let index = 1; index < conditions.length; index += 1) {
    combined = Prisma.sql`${combined} AND ${conditions[index]}`;
  }

  return Prisma.sql`
    SELECT l.id FROM "Listing" l
    WHERE ${combined}
  `;
}
