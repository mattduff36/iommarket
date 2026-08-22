export const CANONICAL_OCEAN_LOCATIONS = [
  "Ocean Ford",
  "Ocean Ford - Transit Centre",
  "Ocean KIA",
] as const;

export type CanonicalOceanLocation = (typeof CANONICAL_OCEAN_LOCATIONS)[number];

export type LocationDecision =
  | { kind: "include"; canonical: CanonicalOceanLocation }
  | { kind: "exclude"; reason: string; normalized: string };

const EXCLUDED_LOCATION_LABELS = [
  "bentley motor group - keighley",
  "bentley motor group keighley",
  "keighley mazda",
  "bnb motorhomes",
  "bn b motorhomes",
  "ocean citroen",
  "ocean citroën",
  "4hire",
  "4 hire",
] as const;

function normalizeLocation(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isTransitCentre(normalized: string) {
  return (
    normalized.includes("transit") &&
    (normalized.includes("ocean") || normalized.includes("ford"))
  );
}

function isOceanKia(normalized: string) {
  return (
    (normalized.includes("ocean") && normalized.includes("kia")) ||
    normalized === "kia"
  );
}

function isOceanFordRetail(normalized: string) {
  if (isTransitCentre(normalized)) return false;
  return (
    normalized === "ocean ford" ||
    normalized === "oceanford" ||
    normalized === "ford"
  );
}

function isExcluded(normalized: string) {
  return EXCLUDED_LOCATION_LABELS.some(
    (label) => normalized === label || normalized.includes(label),
  );
}

export function classifyLocation(locationName: string | null | undefined): LocationDecision {
  const raw = locationName?.trim() ?? "";
  if (!raw) {
    return { kind: "exclude", reason: "missing-location", normalized: "" };
  }

  const normalized = normalizeLocation(raw);
  if (isExcluded(normalized)) {
    return { kind: "exclude", reason: `excluded-location:${raw}`, normalized };
  }
  if (isTransitCentre(normalized)) {
    return { kind: "include", canonical: "Ocean Ford - Transit Centre" };
  }
  if (isOceanKia(normalized)) {
    return { kind: "include", canonical: "Ocean KIA" };
  }
  if (isOceanFordRetail(normalized)) {
    return { kind: "include", canonical: "Ocean Ford" };
  }
  return { kind: "exclude", reason: `other-location:${raw}`, normalized };
}

export function isOceanEligibleLocation(locationName: string | null | undefined) {
  return classifyLocation(locationName).kind === "include";
}
