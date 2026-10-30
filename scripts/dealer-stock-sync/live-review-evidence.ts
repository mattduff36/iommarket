import type { ReviewedActionEvidence } from "../../lib/dealer-stock-sync/types";
import { identityFor, vehicleContentHash } from "./identity";
import { buildTitle, hasSourceTransmissionConflict, resolveCategorySlug } from "./map-listing";
import type { CanonicalVehicle, ReconciledVehicle } from "./types";

/**
 * Server scrape reports only. The installed desktop pipeline must not import this module.
 * Evidence is keyed with the same non-composite identity as inventoryFromReconciled.
 */
export function liveReviewEvidence(input: {
  reconciled: ReconciledVehicle[];
  capturedAt: string;
}): Record<string, ReviewedActionEvidence> {
  const capturedAt = validCapturedAt(input.capturedAt);
  if (!capturedAt) return {};
  const evidence: Record<string, ReviewedActionEvidence> = {};
  for (const item of input.reconciled) {
    const identity = identityFor(item.vehicle);
    if (!identity || identity.kind === "composite" || Object.hasOwn(evidence, identity.key)) continue;
    evidence[identity.key] = evidenceFor(item.vehicle, capturedAt);
  }
  return evidence;
}

function evidenceFor(vehicle: CanonicalVehicle, capturedAt: string): ReviewedActionEvidence {
  const displayTitle = buildTitle(vehicle).trim() || "Vehicle requiring review";
  return {
    displayTitle,
    fuel: textOrNull(vehicle.fuel),
    transmission: textOrNull(vehicle.transmission),
    flags: vehicle.availability === "sold" ? ["sold-exclude-from-live-import"] :
      hasSourceTransmissionConflict(vehicle) ? ["source-transmission-conflict"] : [],
    pricePence: integerOrNull(vehicle.pricePence),
    mileage: integerOrNull(vehicle.mileage, true),
    year: integerOrNull(vehicle.year),
    categorySlug: resolveCategorySlug(vehicle),
    sourceUrl: safeHttps(vehicle.detailUrl),
    safePhotoUrls: safePhotoUrls(vehicle.imageUrls),
    availability: vehicle.availability,
    provenance: [...vehicle.provenance.sourceKeys],
    sourceHash: vehicleContentHash(vehicle),
    capturedAt,
    coverageWarning: null,
    capacityWarning: null,
  };
}

function validCapturedAt(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function textOrNull(value: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function integerOrNull(value: number | null, nonnegative = false) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (nonnegative && value < 0) return null;
  return value;
}

function safeHttps(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return url;
  } catch {
    return null;
  }
}

function safePhotoUrls(urls: string[]) {
  const safe: string[] = [];
  for (const url of urls) {
    if (safe.includes(url)) continue;
    const parsed = safeHttps(url);
    if (parsed) safe.push(parsed);
  }
  return safe.slice(0, 20);
}
