export const OCEAN_SOURCE_KEYS = [
  "omv",
  "ocean-ford",
  "transit-centre",
  "ocean-kia",
] as const;

export type OceanSourceKey = (typeof OCEAN_SOURCE_KEYS)[number];

export interface OceanSourceConfig {
  key: OceanSourceKey;
  name: string;
  startUrl: string;
  required: boolean;
  dedicated: boolean;
}

export const OCEAN_SOURCES: readonly OceanSourceConfig[] = [
  {
    key: "omv",
    name: "Ocean Motor Village",
    startUrl: "https://www.oceanmotorvillage.com/search/",
    required: false,
    dedicated: false,
  },
  {
    key: "ocean-ford",
    name: "Ocean Ford",
    startUrl: "https://www.oceanford.com/used-cars/ocean-ford/",
    required: true,
    dedicated: true,
  },
  {
    key: "transit-centre",
    name: "Ocean Ford - Transit Centre",
    startUrl: "https://www.oceanford.com/transit-centre/",
    required: true,
    dedicated: true,
  },
  {
    key: "ocean-kia",
    name: "Ocean KIA",
    startUrl: "https://www.oceankia.com/used-cars/",
    required: true,
    dedicated: true,
  },
] as const;

export const REQUIRED_SOURCE_KEYS = OCEAN_SOURCES.filter((source) => source.required).map(
  (source) => source.key,
);

export const DEDICATED_SOURCE_KEYS = OCEAN_SOURCES.filter((source) => source.dedicated).map(
  (source) => source.key,
);

export function getOceanSource(key: OceanSourceKey) {
  const source = OCEAN_SOURCES.find((item) => item.key === key);
  if (!source) throw new Error(`Unknown Ocean source: ${key}`);
  return source;
}

export function isDedicatedSource(key: OceanSourceKey) {
  return getOceanSource(key).dedicated;
}

export function isRequiredSource(key: OceanSourceKey) {
  return getOceanSource(key).required;
}
