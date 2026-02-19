const SEARCH_KEYS = [
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
  "bodyType",
  "colour",
  "doors",
  "seats",
  "fuelType",
  "transmission",
  "driveType",
  "sellerType",
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
    const v = merged[key];
    if (v) params.set(key, v);
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
