import { SEARCH_SORT_OPTIONS } from "@/lib/search/search-order";

export const SEARCH_KEYS = [
  "q",
  "category",
  "region",
  "make",
  "model",
  "minPrice",
  "maxPrice",
  "minMileage",
  "maxMileage",
  "minYear",
  "maxYear",
  "page",
  "sort",
  "featured",
  "bodyType",
  "colour",
  "doors",
  "seats",
  "fuelType",
  "transmission",
  "driveType",
  "sellerType",
  "location",
  "includeSold",
  "minEngineSize",
  "maxEngineSize",
  "minEnginePower",
  "maxEnginePower",
  "minBatteryRange",
  "maxBatteryRange",
  "minChargingTime",
  "maxChargingTime",
  "minAcceleration",
  "maxAcceleration",
  "minFuelConsumption",
  "maxFuelConsumption",
  "minCo2",
  "maxCo2",
  "minTax",
  "maxTax",
  "minInsuranceGroup",
  "maxInsuranceGroup",
  "minBootSpace",
  "maxBootSpace",
] as const;

type SearchKey = (typeof SEARCH_KEYS)[number];

export type SearchParams = Partial<Record<SearchKey, string>>;
const MAX_SEARCH_VALUE_LENGTH = 120;
const ACCEPTED_SEARCH_SORTS: ReadonlySet<string> = new Set(
  SEARCH_SORT_OPTIONS.map((option) => option.value),
);

function normalizeSearchValue(
  key: SearchKey,
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim().slice(0, MAX_SEARCH_VALUE_LENGTH);
  if (!normalized) return undefined;

  if (key === "page") {
    if (!/^\d+$/.test(normalized)) return undefined;
    const page = Number.parseInt(normalized, 10);
    return Number.isInteger(page) && page > 1 ? String(page) : undefined;
  }
  if (key === "sort") {
    if (!ACCEPTED_SEARCH_SORTS.has(normalized)) return undefined;
    if (normalized === "featured") return undefined;
  }
  if (
    (key === "featured" || key === "includeSold") &&
    normalized !== "true"
  ) {
    return undefined;
  }

  return normalized;
}

export function normalizeSearchParams(
  searchParams: Record<string, string | undefined>,
): SearchParams {
  const normalized: SearchParams = {};

  for (const key of SEARCH_KEYS) {
    const value = normalizeSearchValue(key, searchParams[key]);
    if (value) normalized[key] = value;
  }

  return normalized;
}

export function buildSearchCanonicalPath(
  searchParams: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const normalized = normalizeSearchParams(searchParams);

  for (const key of SEARCH_KEYS) {
    const value = normalized[key];
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

export function shouldIndexSearch(
  searchParams: Record<string, string | undefined>,
  activeCategorySlug?: string | null,
): boolean {
  return getSearchSeoState(searchParams, activeCategorySlug).indexable;
}

export function getSearchSeoState(
  searchParams: Record<string, string | undefined>,
  activeCategorySlug?: string | null,
): {
  canonicalPath: string;
  indexable: boolean;
} {
  const normalized = normalizeSearchParams(searchParams);
  const keys = Object.keys(normalized);
  const categoryOnly = keys.length === 1 && keys[0] === "category";
  const canonicalParams = { ...normalized };

  if (normalized.category) {
    if (activeCategorySlug) {
      canonicalParams.category = activeCategorySlug;
    } else {
      delete canonicalParams.category;
    }
  }

  return {
    canonicalPath: buildSearchCanonicalPath(canonicalParams),
    indexable:
      keys.length === 0 || (categoryOnly && Boolean(activeCategorySlug)),
  };
}

export function buildSearchUrl(
  current: SearchParams,
  overrides: Partial<Record<SearchKey, string | undefined>>,
  basePath = "/search",
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };

  const hasFilterChange = SEARCH_KEYS.filter((k) => k !== "page").some(
    (k) => k in overrides,
  );
  if (hasFilterChange) {
    delete merged.page;
  }

  for (const key of SEARCH_KEYS) {
    const v = normalizeSearchValue(key, merged[key]);
    if (v) params.set(key, v);
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
