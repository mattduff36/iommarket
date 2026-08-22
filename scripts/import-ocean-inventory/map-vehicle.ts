import { FUEL_TYPE_OPTIONS } from "../../lib/constants/fuel-types";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { IMPORT_REGION_SLUG } from "./target";
import type { CanonicalOceanLocation } from "./locations";
import type { MappedListing, MappingOutcome, NormalizedVehicle, ReconciledVehicle } from "./types";

const BODY_TYPES = [
  "Hatchback",
  "Saloon",
  "SUV",
  "Estate",
  "Coupe",
  "Convertible",
  "MPV",
  "Pickup",
] as const;

const COLOURS = [
  "Black",
  "White",
  "Silver",
  "Grey",
  "Blue",
  "Red",
  "Green",
  "Yellow",
  "Orange",
  "Brown",
  "Gold",
  "Bronze",
  "Other",
] as const;

const MAX_PRICE_PENCE = 100_000_000;
const MIN_PRICE_PENCE = 100;
const MIN_TITLE = 5;
const MAX_TITLE = 120;
const MIN_DESCRIPTION = 20;
const MAX_DESCRIPTION = 5000;

export function poundsToPence(pounds: number) {
  return Math.round(pounds * 100);
}

export function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueImageUrls(urls: string[], max = FEATURED_LISTING_PHOTO_LIMIT) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of urls) {
    const url = normalizeImageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
    if (unique.length >= max) break;
  }
  return unique;
}

export function normalizeImageUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

export function mapFuelType(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("plug") && normalized.includes("diesel")) return "Diesel Plug-in Hybrid";
  if (normalized.includes("plug")) return "Petrol Plug-in Hybrid";
  if (normalized.includes("diesel") && normalized.includes("hybrid")) return "Diesel Hybrid";
  if (normalized.includes("petrol") && normalized.includes("hybrid")) return "Petrol Hybrid";
  if (normalized.includes("hybrid")) return "Petrol Hybrid";
  if (normalized.includes("electric") || normalized === "ev") return "Electric";
  if (normalized.includes("diesel")) return "Diesel";
  if (normalized.includes("petrol") || normalized.includes("gasoline")) return "Petrol";
  return FUEL_TYPE_OPTIONS.includes(value as (typeof FUEL_TYPE_OPTIONS)[number])
    ? (value as (typeof FUEL_TYPE_OPTIONS)[number])
    : null;
}

export function mapTransmission(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("manual")) return "Manual";
  if (
    normalized.includes("auto") ||
    normalized.includes("dsg") ||
    normalized.includes("dct") ||
    normalized.includes("cvt")
  ) {
    return "Automatic";
  }
  return null;
}

export function mapBodyType(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("hatch")) return "Hatchback";
  if (normalized.includes("saloon") || normalized.includes("sedan")) return "Saloon";
  if (normalized.includes("estate") || normalized.includes("touring")) return "Estate";
  if (normalized.includes("coupe") || normalized.includes("coupé")) return "Coupe";
  if (normalized.includes("convert") || normalized.includes("cabriolet")) return "Convertible";
  if (normalized.includes("pickup") || normalized.includes("pick up") || normalized.includes("pick-up")) {
    return "Pickup";
  }
  if (normalized.includes("mpv") || normalized.includes("people")) return "MPV";
  if (normalized.includes("suv") || normalized.includes("4x4") || normalized.includes("crossover")) {
    return "SUV";
  }
  return BODY_TYPES.includes(value as (typeof BODY_TYPES)[number])
    ? (value as (typeof BODY_TYPES)[number])
    : null;
}

export function mapColour(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("gray") || normalized.includes("grey")) return "Grey";
  const match = COLOURS.find((colour) => normalized.includes(colour.toLowerCase()));
  return match ?? "Other";
}

export function mapEngineSize(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]+/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const litres = numeric > 10 ? numeric / 1000 : numeric;
  if (litres < 0.1 || litres > 10) return null;
  return Math.round(litres * 10) / 10;
}

export function resolveCategorySlug(input: {
  locationName: CanonicalOceanLocation | string;
  vehicleType: string | null | undefined;
}): "car" | "van" {
  const type = input.vehicleType?.toLowerCase() ?? "";
  if (type.includes("van") || type.includes("commercial") || type === "lcv") return "van";
  if (input.locationName.toLowerCase().includes("transit")) return "van";
  return "car";
}

export function buildTitle(vehicle: Pick<NormalizedVehicle, "year" | "make" | "model" | "derivative">) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.derivative]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
}

export function buildDescription(vehicle: NormalizedVehicle) {
  const cleaned = stripHtml(vehicle.description);
  if (cleaned.length >= MIN_DESCRIPTION) return cleaned.slice(0, MAX_DESCRIPTION);
  const fallback = [
    [vehicle.year, vehicle.make, vehicle.model, vehicle.derivative].filter(Boolean).join(" "),
    vehicle.mileage != null ? `${vehicle.mileage.toLocaleString("en-GB")} miles` : null,
    vehicle.fuel,
    vehicle.transmission,
    vehicle.colour,
    vehicle.locationName,
  ]
    .filter(Boolean)
    .join(". ");
  const padded = fallback.length >= MIN_DESCRIPTION
    ? fallback
    : `${fallback}. Dealer stock imported from Ocean Motor Village.`;
  return padded.slice(0, MAX_DESCRIPTION);
}

export function mapReconciledVehicle(reconciled: ReconciledVehicle): MappingOutcome {
  if (reconciled.identityConflict) {
    return {
      reconciled,
      listing: null,
      skipReason: "identity-conflict",
      skipDetail: reconciled.conflictReason,
    };
  }

  const vehicle = reconciled.vehicle;
  if (vehicle.isPoa) {
    return { reconciled, listing: null, skipReason: "poa", skipDetail: "POA" };
  }
  if (vehicle.pricePence == null) {
    return { reconciled, listing: null, skipReason: "missing-price", skipDetail: "No price" };
  }
  if (
    !Number.isInteger(vehicle.pricePence) ||
    vehicle.pricePence < MIN_PRICE_PENCE ||
    vehicle.pricePence > MAX_PRICE_PENCE
  ) {
    return {
      reconciled,
      listing: null,
      skipReason: "invalid-price",
      skipDetail: `Price ${vehicle.pricePence} is out of range`,
    };
  }
  if (
    vehicle.year == null ||
    !vehicle.make.trim() ||
    !vehicle.model.trim() ||
    vehicle.mileage == null
  ) {
    return {
      reconciled,
      listing: null,
      skipReason: "missing-required-attr",
      skipDetail: "make/model/year/mileage required",
    };
  }

  const title = buildTitle(vehicle);
  if (title.length < MIN_TITLE) {
    return {
      reconciled,
      listing: null,
      skipReason: "invalid-title",
      skipDetail: "Title too short",
    };
  }

  const attributes: Record<string, string> = {
    make: vehicle.make.trim(),
    model: vehicle.model.trim(),
    year: String(vehicle.year),
    mileage: String(vehicle.mileage),
    "write-off-category": "None",
  };
  const fuel = mapFuelType(vehicle.fuel);
  const transmission = mapTransmission(vehicle.transmission);
  const bodyType = mapBodyType(vehicle.bodyType);
  const colour = mapColour(vehicle.colour);
  if (fuel) attributes["fuel-type"] = fuel;
  if (transmission) attributes.transmission = transmission;
  if (bodyType) attributes["body-type"] = bodyType;
  if (colour) attributes.colour = colour;
  if (vehicle.doors != null) attributes.doors = String(vehicle.doors);
  if (vehicle.seats != null) attributes.seats = String(vehicle.seats);
  if (vehicle.engineSize != null) attributes["engine-size"] = String(vehicle.engineSize);
  if (vehicle.enginePower != null) attributes["engine-power"] = String(vehicle.enginePower);

  const listing: MappedListing = {
    title,
    description: buildDescription(vehicle),
    pricePence: vehicle.pricePence,
    categorySlug: resolveCategorySlug({
      locationName: reconciled.locationName,
      vehicleType: vehicle.vehicleType,
    }),
    regionSlug: IMPORT_REGION_SLUG,
    attributes,
    imageUrls: uniqueImageUrls(vehicle.imageUrls),
    identity: {
      year: vehicle.year,
      make: attributes.make,
      model: attributes.model,
      mileage: vehicle.mileage,
      pricePence: vehicle.pricePence,
    },
  };

  return { reconciled, listing, skipReason: null, skipDetail: null };
}

export function matchesExistingListing(
  existing: Array<{ year: string; make: string; model: string; mileage: string; pricePence: number }>,
  listing: MappedListing,
) {
  return existing.some(
    (item) =>
      item.year === listing.identity.year.toString() &&
      item.make.toLowerCase() === listing.identity.make.toLowerCase() &&
      item.model.toLowerCase() === listing.identity.model.toLowerCase() &&
      item.mileage === listing.identity.mileage.toString() &&
      item.pricePence === listing.identity.pricePence,
  );
}

export function selectWithinCap<T>(
  items: T[],
  remainingSlots: number,
  rank: (item: T) => { year: number; mileage: number },
): { selected: T[]; leftovers: T[] } {
  if (remainingSlots <= 0) return { selected: [], leftovers: items };
  const sorted = [...items].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    if (rightRank.year !== leftRank.year) return rightRank.year - leftRank.year;
    return leftRank.mileage - rightRank.mileage;
  });
  return {
    selected: sorted.slice(0, remainingSlots),
    leftovers: sorted.slice(remainingSlots),
  };
}
