import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { FUEL_TYPE_OPTIONS } from "../../lib/constants/fuel-types";
import { normalizeImageUrl } from "./json";
import type { CanonicalVehicle, ReconciledVehicle } from "./types";

const MIN_PRICE_PENCE = 100;
const MAX_PRICE_PENCE = 100_000_000;
const MIN_TITLE = 5;
const MAX_TITLE = 120;
const MIN_DESCRIPTION = 20;
const MAX_DESCRIPTION = 5000;

export interface MappedArchiveListing {
  title: string;
  description: string;
  pricePence: number;
  categorySlug: "car" | "van";
  attributes: Record<string, string>;
  imageUrls: string[];
}

export interface MappingOutcome {
  reconciled: ReconciledVehicle;
  listing: MappedArchiveListing | null;
  skipReason: string | null;
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

export function resolveCategorySlug(vehicle: CanonicalVehicle): "car" | "van" {
  const type = vehicle.vehicleType?.toLowerCase() ?? "";
  if (type.includes("van") || type.includes("commercial") || type === "lcv") return "van";
  if ((vehicle.locationName ?? "").toLowerCase().includes("transit")) return "van";
  return "car";
}

export function buildTitle(vehicle: CanonicalVehicle) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.derivative]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
}

export function mapReconciledVehicle(reconciled: ReconciledVehicle): MappingOutcome {
  if (reconciled.identityConflict) {
    return { reconciled, listing: null, skipReason: reconciled.conflictReason ?? "identity-conflict" };
  }
  const vehicle = reconciled.vehicle;
  if (vehicle.isPoa) return { reconciled, listing: null, skipReason: "poa" };
  if (vehicle.pricePence == null) return { reconciled, listing: null, skipReason: "missing-price" };
  if (
    !Number.isInteger(vehicle.pricePence) ||
    vehicle.pricePence < MIN_PRICE_PENCE ||
    vehicle.pricePence > MAX_PRICE_PENCE
  ) {
    return { reconciled, listing: null, skipReason: "invalid-price" };
  }
  if (!vehicle.make.trim() || !vehicle.model.trim() || vehicle.year == null || vehicle.mileage == null) {
    return { reconciled, listing: null, skipReason: "missing-required-attr" };
  }
  const title = buildTitle(vehicle);
  if (title.length < MIN_TITLE) return { reconciled, listing: null, skipReason: "invalid-title" };

  const description =
    vehicle.description.trim().length >= MIN_DESCRIPTION
      ? vehicle.description.trim().slice(0, MAX_DESCRIPTION)
      : `${title}. ${vehicle.mileage.toLocaleString("en-GB")} miles.`.slice(0, MAX_DESCRIPTION);

  const attributes: Record<string, string> = {
    make: vehicle.make.trim(),
    model: vehicle.model.trim(),
    year: String(vehicle.year),
    mileage: String(vehicle.mileage),
    "write-off-category": "None",
  };
  const fuel = mapFuelType(vehicle.fuel);
  const transmission = mapTransmission(vehicle.transmission);
  if (fuel) attributes["fuel-type"] = fuel;
  if (transmission) attributes.transmission = transmission;

  return {
    reconciled,
    listing: {
      title,
      description,
      pricePence: vehicle.pricePence,
      categorySlug: resolveCategorySlug(vehicle),
      attributes,
      imageUrls: uniqueImageUrls(vehicle.imageUrls),
    },
    skipReason: null,
  };
}
