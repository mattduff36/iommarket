import { Prisma } from "@prisma/client";
import { BODY_TYPE_OPTIONS } from "@/lib/constants/search-filters";
import {
  storedDecimalSql,
  type NumericAttributeRange,
} from "@/lib/listings/numeric-attribute-search";
import {
  bodyTypePresentation,
  findVehicleDetailAttribute,
  type VehicleDetailAttribute,
} from "@/lib/listings/vehicle-detail-catalog";

export const CATEGORY_SEARCH_KEYS = [
  "wheelbase",
  "roofHeight",
  "minPayload",
  "maxPayload",
  "minLoadLength",
  "maxLoadLength",
  "minGvw",
  "maxGvw",
  "minBerths",
  "maxBerths",
  "minBeltedSeats",
  "maxBeltedSeats",
  "sleepingLayout",
  "mainLayout",
  "minOverallLength",
  "maxOverallLength",
  "minMtplm",
  "maxMtplm",
] as const;

export type CategorySearchKey = (typeof CATEGORY_SEARCH_KEYS)[number];

export const VEHICLE_CATEGORY_SLUGS = ["car", "van", "motorbike", "motorhome"] as const;
export type VehicleCategorySlug = (typeof VEHICLE_CATEGORY_SLUGS)[number];

const LABEL_TO_SLUG: Record<string, VehicleCategorySlug> = {
  car: "car",
  cars: "car",
  van: "van",
  vans: "van",
  motorbike: "motorbike",
  motorbikes: "motorbike",
  motorcycle: "motorbike",
  motorcycles: "motorbike",
  motorhome: "motorhome",
  motorhomes: "motorhome",
};

type SelectKey = "wheelbase" | "roofHeight" | "sleepingLayout" | "mainLayout";
type RangeKey = "payload" | "loadLength" | "gvw" | "berths" | "beltedSeats" | "overallLength" | "mtplm";

interface SelectSpec {
  key: SelectKey;
  category: "van" | "motorhome";
  slug: string;
}

interface RangeSpec {
  key: RangeKey;
  category: "van" | "motorhome";
  slug: string;
  minKey: CategorySearchKey;
  maxKey: CategorySearchKey;
}

const SELECT_SPECS: readonly SelectSpec[] = [
  { key: "wheelbase", category: "van", slug: "wheelbase" },
  { key: "roofHeight", category: "van", slug: "roof-height" },
  { key: "sleepingLayout", category: "motorhome", slug: "sleeping-layout" },
  { key: "mainLayout", category: "motorhome", slug: "main-layout" },
];

const RANGE_SPECS: readonly RangeSpec[] = [
  { key: "payload", category: "van", slug: "payload-kg", minKey: "minPayload", maxKey: "maxPayload" },
  { key: "loadLength", category: "van", slug: "load-length-m", minKey: "minLoadLength", maxKey: "maxLoadLength" },
  { key: "gvw", category: "van", slug: "gvw-kg", minKey: "minGvw", maxKey: "maxGvw" },
  { key: "berths", category: "motorhome", slug: "sleeping-berths", minKey: "minBerths", maxKey: "maxBerths" },
  { key: "beltedSeats", category: "motorhome", slug: "belted-travelling-seats", minKey: "minBeltedSeats", maxKey: "maxBeltedSeats" },
  { key: "overallLength", category: "motorhome", slug: "overall-length-m", minKey: "minOverallLength", maxKey: "maxOverallLength" },
  { key: "mtplm", category: "motorhome", slug: "mtplm-kg", minKey: "minMtplm", maxKey: "maxMtplm" },
];

export interface CategoryOption {
  label: string;
  value: string;
}

export interface CategorySearchProfile {
  slug: VehicleCategorySlug | null;
  bodyLabel: string;
  bodyOptions: readonly string[];
  showBody: boolean;
  showDoors: boolean;
  showBoot: boolean;
}

export interface CategorySelectControl {
  key: SelectKey;
  label: string;
  options: readonly string[];
}

export interface CategoryRangeControl {
  key: RangeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  decimal: boolean;
  formatValue: (value: number) => string;
}

export interface CategoryControlState {
  selects: Record<SelectKey, string>;
  ranges: Record<RangeKey, [number, number]>;
}

interface NumericLimits {
  min: number;
  max: number;
  decimal: boolean;
  step: number;
}

function catalogAttribute(
  category: "van" | "motorhome",
  slug: string,
): VehicleDetailAttribute | undefined {
  const attribute = findVehicleDetailAttribute(category, slug);
  if (!attribute) return undefined;
  return attribute;
}

function numericLimits(category: "van" | "motorhome", slug: string): NumericLimits | null {
  const attribute = catalogAttribute(category, slug);
  if (
    !attribute
    || attribute.dataType !== "number"
    || attribute.min === undefined
    || attribute.max === undefined
    || !Number.isFinite(attribute.min)
    || !Number.isFinite(attribute.max)
    || attribute.min > attribute.max
  ) {
    return null;
  }
  const step = attribute.step ?? 1;
  if (!Number.isFinite(step) || step <= 0) return null;
  return { min: attribute.min, max: attribute.max, step, decimal: step < 1 };
}

function selectOptions(category: "van" | "motorhome", slug: string): readonly string[] | null {
  const options = catalogAttribute(category, slug)?.options;
  if (!options || options.length === 0) return null;
  return options;
}

export function knownVehicleCategorySlug(
  category: string | null | undefined,
): VehicleCategorySlug | null {
  const normalized = category?.trim().toLowerCase();
  if (!normalized) return null;
  return (VEHICLE_CATEGORY_SLUGS as readonly string[]).includes(normalized)
    ? (normalized as VehicleCategorySlug)
    : null;
}

export function resolveVehicleCategorySlug(
  category: string | null | undefined,
  categories: readonly CategoryOption[] = [],
): VehicleCategorySlug | null {
  const direct = knownVehicleCategorySlug(category);
  if (direct) return direct;
  const raw = category?.trim();
  if (!raw) return null;
  const match = categories.find((option) => option.value === raw);
  if (!match) return null;
  return knownVehicleCategorySlug(match.value)
    ?? LABEL_TO_SLUG[match.label.trim().toLowerCase()]
    ?? null;
}

export function categorySearchProfile(
  slug: VehicleCategorySlug | null,
): CategorySearchProfile {
  if (slug === "motorbike") {
    return {
      slug,
      bodyLabel: "Body Type",
      bodyOptions: [],
      showBody: false,
      showDoors: false,
      showBoot: false,
    };
  }
  if (slug === "van" || slug === "motorhome") {
    const presentation = bodyTypePresentation(slug);
    return {
      slug,
      bodyLabel: presentation?.name ?? "Body Type",
      bodyOptions: presentation?.options ?? [],
      showBody: Boolean(presentation?.options.length),
      showDoors: true,
      showBoot: true,
    };
  }
  return {
    slug,
    bodyLabel: "Body Type",
    bodyOptions: BODY_TYPE_OPTIONS,
    showBody: true,
    showDoors: true,
    showBoot: true,
  };
}

function formatRangeValue(value: number, decimal: boolean, slug: string): string {
  if (decimal) {
    const rounded = Math.round(value * 100) / 100;
    return `${String(rounded)} m`;
  }
  if (slug.endsWith("-kg")) return `${value.toLocaleString("en-GB")} kg`;
  return String(value);
}

export function categorySearchControls(
  slug: VehicleCategorySlug | null,
): { selects: CategorySelectControl[]; ranges: CategoryRangeControl[] } {
  if (slug !== "van" && slug !== "motorhome") return { selects: [], ranges: [] };
  const selects: CategorySelectControl[] = [];
  for (const spec of SELECT_SPECS) {
    if (spec.category !== slug) continue;
    const options = selectOptions(spec.category, spec.slug);
    const attribute = catalogAttribute(spec.category, spec.slug);
    if (!options || !attribute) continue;
    selects.push({ key: spec.key, label: attribute.name, options });
  }
  const ranges: CategoryRangeControl[] = [];
  for (const spec of RANGE_SPECS) {
    if (spec.category !== slug) continue;
    const limits = numericLimits(spec.category, spec.slug);
    const attribute = catalogAttribute(spec.category, spec.slug);
    if (!limits || !attribute) continue;
    ranges.push({
      key: spec.key,
      label: attribute.name,
      min: limits.min,
      max: limits.max,
      step: limits.step,
      decimal: limits.decimal,
      formatValue: (value) => formatRangeValue(value, limits.decimal, spec.slug),
    });
  }
  return { selects, ranges };
}

export function emptyCategoryControlState(): CategoryControlState {
  const selects = {
    wheelbase: "",
    roofHeight: "",
    sleepingLayout: "",
    mainLayout: "",
  };
  const ranges = {} as CategoryControlState["ranges"];
  for (const spec of RANGE_SPECS) {
    const limits = numericLimits(spec.category, spec.slug);
    ranges[spec.key] = limits ? [limits.min, limits.max] : [0, 0];
  }
  return { selects, ranges };
}

function parseBound(input: string | undefined, limits: NumericLimits): number | undefined {
  if (!input) return undefined;
  const text = input.trim();
  const pattern = limits.decimal ? /^(?:\d{1,6}(?:\.\d{1,2})?|\.\d{1,2})$/u : /^\d{1,6}$/u;
  if (!pattern.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < limits.min || value > limits.max) return undefined;
  if (!limits.decimal && !Number.isInteger(value)) return undefined;
  return value;
}

function acceptedOption(input: string | undefined, options: readonly string[] | null): string | undefined {
  if (!input || !options) return undefined;
  return options.includes(input) ? input : undefined;
}

export function categoryControlsFromParams(
  params: Partial<Record<CategorySearchKey, string | undefined>>,
): CategoryControlState {
  const state = emptyCategoryControlState();
  for (const spec of SELECT_SPECS) {
    const options = selectOptions(spec.category, spec.slug);
    state.selects[spec.key] = acceptedOption(params[spec.key], options) ?? "";
  }
  for (const spec of RANGE_SPECS) {
    const limits = numericLimits(spec.category, spec.slug);
    if (!limits) continue;
    const min = parseBound(params[spec.minKey], limits);
    const max = parseBound(params[spec.maxKey], limits);
    if (min === undefined && max === undefined) continue;
    const lower = min ?? limits.min;
    const upper = max ?? limits.max;
    state.ranges[spec.key] = lower <= upper ? [lower, upper] : [limits.min, limits.max];
  }
  return state;
}

export function categoryControlsToParams(
  state: CategoryControlState,
  slug: VehicleCategorySlug | null,
): Partial<Record<CategorySearchKey, string>> {
  const params: Partial<Record<CategorySearchKey, string>> = {};
  const controls = categorySearchControls(slug);
  for (const control of controls.selects) {
    const value = acceptedOption(state.selects[control.key], control.options);
    if (value) params[control.key] = value;
  }
  for (const control of controls.ranges) {
    const spec = RANGE_SPECS.find((item) => item.key === control.key);
    if (!spec) continue;
    const [min, max] = state.ranges[control.key];
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) continue;
    if (min > control.min) params[spec.minKey] = formatBound(min, control.decimal);
    if (max < control.max) params[spec.maxKey] = formatBound(max, control.decimal);
  }
  return params;
}

function formatBound(value: number, decimal: boolean): string {
  if (!decimal) return String(Math.trunc(value));
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function bodyOptionsFor(
  slug: VehicleCategorySlug | null,
  unresolvedCategory: boolean,
): readonly string[] | null {
  if (slug === "motorbike") return [];
  if (slug === "van" || slug === "motorhome") return bodyTypePresentation(slug)?.options ?? [];
  if (slug === "car" || !unresolvedCategory) return BODY_TYPE_OPTIONS;
  return [...BODY_TYPE_OPTIONS, ...(bodyTypePresentation("van")?.options ?? []), ...(bodyTypePresentation("motorhome")?.options ?? [])];
}

export function scopeCategorySearchRecord<T extends Record<string, string | undefined>>(
  params: T,
  categorySlug: string | null | undefined,
  options?: { unresolvedCategory?: boolean },
): T {
  const slug = knownVehicleCategorySlug(categorySlug);
  const unresolvedCategory = Boolean(options?.unresolvedCategory) && !slug;
  const next: Record<string, string | undefined> = { ...params };
  const active = unresolvedCategory ? null : slug;

  for (const spec of SELECT_SPECS) {
    const allowed = unresolvedCategory || spec.category === active;
    const optionsForSpec = allowed ? selectOptions(spec.category, spec.slug) : [];
    next[spec.key] = acceptedOption(next[spec.key], optionsForSpec);
  }

  for (const spec of RANGE_SPECS) {
    const allowed = unresolvedCategory || spec.category === active;
    const limits = allowed ? numericLimits(spec.category, spec.slug) : null;
    if (!limits) {
      next[spec.minKey] = undefined;
      next[spec.maxKey] = undefined;
      continue;
    }
    const min = parseBound(next[spec.minKey], limits);
    const max = parseBound(next[spec.maxKey], limits);
    if (min !== undefined && max !== undefined && min > max) {
      next[spec.minKey] = undefined;
      next[spec.maxKey] = undefined;
      continue;
    }
    next[spec.minKey] = min === undefined ? undefined : formatBound(min, limits.decimal);
    next[spec.maxKey] = max === undefined ? undefined : formatBound(max, limits.decimal);
  }

  const profile = categorySearchProfile(active);
  if (!profile.showDoors) next.doors = undefined;
  if (!profile.showBoot) {
    next.minBootSpace = undefined;
    next.maxBootSpace = undefined;
  }
  const bodyOptions = bodyOptionsFor(active, unresolvedCategory);
  next.bodyType = acceptedOption(next.bodyType, bodyOptions);

  for (const key of Object.keys(next)) {
    if (!next[key]) delete next[key];
  }
  return next as T;
}

export function categoryExactFilters(
  params: Record<string, string | undefined>,
  categorySlug: VehicleCategorySlug | null,
): Array<{ slug: string; values: readonly string[] }> {
  if (categorySlug !== "van" && categorySlug !== "motorhome") return [];
  const filters: Array<{ slug: string; values: readonly string[] }> = [];
  for (const spec of SELECT_SPECS) {
    if (spec.category !== categorySlug) continue;
    const value = acceptedOption(params[spec.key], selectOptions(spec.category, spec.slug));
    if (value) filters.push({ slug: spec.slug, values: [value] });
  }
  return filters;
}

export function categoryNumericFilters(
  params: Record<string, string | undefined>,
  categorySlug: VehicleCategorySlug | null,
): NumericAttributeRange[] {
  if (categorySlug !== "van" && categorySlug !== "motorhome") return [];
  const filters: NumericAttributeRange[] = [];
  for (const spec of RANGE_SPECS) {
    if (spec.category !== categorySlug) continue;
    const limits = numericLimits(spec.category, spec.slug);
    if (!limits) continue;
    const min = parseBound(params[spec.minKey], limits);
    const max = parseBound(params[spec.maxKey], limits);
    if (min === undefined && max === undefined) continue;
    if (min !== undefined && max !== undefined && min > max) continue;
    filters.push({
      slug: spec.slug,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    });
  }
  return filters;
}

export function categoryNumericListingIdQuery(
  filters: readonly NumericAttributeRange[],
): Prisma.Sql {
  if (filters.length === 0) {
    throw new Error("categoryNumericListingIdQuery requires at least one filter");
  }
  const conditions = filters.map((filter) => {
    const spec = RANGE_SPECS.find((item) => item.slug === filter.slug);
    const limits = spec ? numericLimits(spec.category, spec.slug) : null;
    const min = filter.min ?? limits?.min;
    const max = filter.max ?? limits?.max;
    if (
      !spec
      || !limits
      || min === undefined
      || max === undefined
      || !Number.isFinite(min)
      || !Number.isFinite(max)
      || min > max
      || min < limits.min
      || max > limits.max
      || (!limits.decimal && (!Number.isInteger(min) || !Number.isInteger(max)))
    ) {
      throw new Error("Category numeric filter bounds are invalid");
    }
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ListingAttributeValue" lav
      INNER JOIN "AttributeDefinition" ad ON ad.id = lav."attributeDefinitionId"
      WHERE lav."listingId" = l.id
        AND ad.slug = ${spec.slug}
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
