import { classifyLocation, type CanonicalOceanLocation } from "./locations";
import { uniqueImageUrls } from "./map-vehicle";
import { DEDICATED_SOURCE_KEYS, isDedicatedSource, type OceanSourceKey } from "./sources";
import type {
  IdentityKind,
  NormalizedVehicle,
  ReconciledVehicle,
  SourceListResult,
} from "./types";

function completeness(vehicle: NormalizedVehicle) {
  return (
    uniqueImageUrls(vehicle.imageUrls, 99).length * 3 +
    vehicle.description.trim().length +
    (vehicle.year != null ? 25 : 0) +
    (vehicle.mileage != null ? 25 : 0) +
    (vehicle.pricePence != null ? 15 : 0) +
    (vehicle.fuel ? 5 : 0) +
    (vehicle.transmission ? 5 : 0) +
    (vehicle.bodyType ? 5 : 0) +
    (vehicle.colour ? 5 : 0) +
    (vehicle.engineSize != null ? 5 : 0) +
    (vehicle.enginePower != null ? 5 : 0)
  );
}

function preferVehicle(left: NormalizedVehicle, right: NormalizedVehicle) {
  const leftDedicated = isDedicatedSource(left.sourceKey);
  const rightDedicated = isDedicatedSource(right.sourceKey);
  if (leftDedicated !== rightDedicated) {
    const dedicated = leftDedicated ? left : right;
    const other = leftDedicated ? right : left;
    return completeness(dedicated) >= completeness(other) ? dedicated : other;
  }
  return completeness(right) > completeness(left) ? right : left;
}

function mergeVehicles(records: NormalizedVehicle[]): NormalizedVehicle {
  const preferred = records.reduce((best, current) => preferVehicle(best, current));
  const imageUrls = uniqueImageUrls(records.flatMap((record) => record.imageUrls));
  const description = records
    .slice()
    .sort((left, right) => {
      const leftDedicated = isDedicatedSource(left.sourceKey) ? 1 : 0;
      const rightDedicated = isDedicatedSource(right.sourceKey) ? 1 : 0;
      if (rightDedicated !== leftDedicated) return rightDedicated - leftDedicated;
      return right.description.length - left.description.length;
    })[0]?.description ?? preferred.description;

  return {
    ...preferred,
    make: preferred.make || records.find((record) => record.make)?.make || preferred.make,
    model: preferred.model || records.find((record) => record.model)?.model || preferred.model,
    year: preferred.year ?? records.find((record) => record.year != null)?.year ?? null,
    mileage: preferred.mileage ?? records.find((record) => record.mileage != null)?.mileage ?? null,
    pricePence:
      preferred.pricePence ??
      records.find((record) => record.pricePence != null)?.pricePence ??
      null,
    isPoa: preferred.pricePence != null ? preferred.isPoa : records.some((record) => record.isPoa),
    description,
    imageUrls,
    fuel: preferred.fuel ?? records.find((record) => record.fuel)?.fuel ?? null,
    transmission:
      preferred.transmission ??
      records.find((record) => record.transmission)?.transmission ??
      null,
    bodyType: preferred.bodyType ?? records.find((record) => record.bodyType)?.bodyType ?? null,
    colour: preferred.colour ?? records.find((record) => record.colour)?.colour ?? null,
    doors: preferred.doors ?? records.find((record) => record.doors != null)?.doors ?? null,
    seats: preferred.seats ?? records.find((record) => record.seats != null)?.seats ?? null,
    engineSize:
      preferred.engineSize ??
      records.find((record) => record.engineSize != null)?.engineSize ??
      null,
    enginePower:
      preferred.enginePower ??
      records.find((record) => record.enginePower != null)?.enginePower ??
      null,
  };
}

function identityFor(vehicle: NormalizedVehicle): { key: string; kind: IdentityKind } | null {
  if (vehicle.stockId) return { key: `stockId:${vehicle.stockId.toLowerCase()}`, kind: "stockId" };
  if (vehicle.registration) {
    return {
      key: `registration:${vehicle.registration.replace(/\s+/g, "").toUpperCase()}`,
      kind: "registration",
    };
  }
  if (vehicle.stockReference) {
    return {
      key: `stockReference:${vehicle.stockReference.toLowerCase()}`,
      kind: "stockReference",
    };
  }
  if (vehicle.detailUrl) {
    return { key: `detailUrl:${canonicalizeUrl(vehicle.detailUrl)}`, kind: "detailUrl" };
  }
  if (
    vehicle.make &&
    vehicle.model &&
    vehicle.year != null &&
    vehicle.mileage != null &&
    vehicle.pricePence != null
  ) {
    return {
      key: [
        "composite",
        vehicle.make.toLowerCase(),
        vehicle.model.toLowerCase(),
        (vehicle.derivative ?? "").toLowerCase(),
        vehicle.year,
        vehicle.mileage,
        vehicle.pricePence,
      ].join(":"),
      kind: "composite",
    };
  }
  return null;
}

function canonicalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

function locationConflict(records: NormalizedVehicle[]) {
  const included = new Set<CanonicalOceanLocation>();
  const excluded: string[] = [];
  for (const record of records) {
    const decision = classifyLocation(record.locationName);
    if (decision.kind === "include") included.add(decision.canonical);
    else excluded.push(record.locationName);
  }
  if (included.size > 1) {
    return `conflicting included locations for the same vehicle: ${[...included].join(", ")}`;
  }
  if (included.size > 0 && excluded.length > 0) {
    return `included and excluded locations for the same vehicle: ${[...included].join(", ")} vs ${excluded.join(", ")}`;
  }
  return null;
}

function preferredLocation(records: NormalizedVehicle[]): CanonicalOceanLocation | null {
  const dedicated = records.filter((record) => isDedicatedSource(record.sourceKey));
  for (const record of dedicated.length > 0 ? dedicated : records) {
    const decision = classifyLocation(record.locationName);
    if (decision.kind === "include") return decision.canonical;
  }
  return null;
}

function pricesMismatch(records: NormalizedVehicle[]) {
  const prices = records
    .map((record) => record.pricePence)
    .filter((price): price is number => price != null);
  if (prices.length < 2) return false;
  return Math.max(...prices) - Math.min(...prices) > 100;
}

export function filterOceanEligible(vehicles: NormalizedVehicle[]) {
  const eligible: NormalizedVehicle[] = [];
  const excluded: Array<{ vehicle: NormalizedVehicle; reason: string }> = [];
  for (const vehicle of vehicles) {
    const decision = classifyLocation(vehicle.locationName);
    if (decision.kind === "include") {
      eligible.push({ ...vehicle, locationName: decision.canonical });
    } else {
      excluded.push({ vehicle, reason: decision.reason });
    }
  }
  return { eligible, excluded };
}

export function reconcileVehicles(sourceResults: SourceListResult[]) {
  const groups = new Map<string, { kind: IdentityKind; records: NormalizedVehicle[] }>();
  const ungrouped: NormalizedVehicle[] = [];

  for (const result of sourceResults) {
    if (result.status !== "ok") continue;
    for (const vehicle of result.vehicles) {
      const identity = identityFor(vehicle);
      if (!identity) {
        ungrouped.push(vehicle);
        continue;
      }
      const existing = groups.get(identity.key);
      if (existing) existing.records.push(vehicle);
      else groups.set(identity.key, { kind: identity.kind, records: [vehicle] });
    }
  }

  const reconciled: ReconciledVehicle[] = [];
  for (const [identityKey, group] of groups) {
    const conflictReason = locationConflict(group.records);
    const locationName = preferredLocation(group.records);
    if (!locationName && !conflictReason) continue;
    const includedRecords = group.records.filter(
      (record) => classifyLocation(record.locationName).kind === "include",
    );
    const recordsForMerge = includedRecords.length > 0 ? includedRecords : group.records;
    const mergedVehicle = mergeVehicles(recordsForMerge);
    const sources = [...new Set(group.records.map((record) => record.sourceKey))];
    reconciled.push({
      identityKey,
      identityKind: group.kind,
      sources,
      preferredSource: mergedVehicle.sourceKey,
      locationName: locationName ?? "Ocean Ford",
      vehicle: {
        ...mergedVehicle,
        locationName: locationName ?? mergedVehicle.locationName,
      },
      priceMismatch: pricesMismatch(recordsForMerge),
      identityConflict: Boolean(conflictReason),
      conflictReason,
    });
  }

  for (const vehicle of ungrouped) {
    const decision = classifyLocation(vehicle.locationName);
    if (decision.kind !== "include") continue;
    reconciled.push({
      identityKey: `ungrouped:${vehicle.sourceKey}:${vehicle.make}:${vehicle.model}:${vehicle.year}:${vehicle.mileage}`,
      identityKind: "composite",
      sources: [vehicle.sourceKey],
      preferredSource: vehicle.sourceKey,
      locationName: decision.canonical,
      vehicle: { ...vehicle, locationName: decision.canonical },
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
    });
  }

  return reconciled;
}

export function overlapBreakdown(reconciled: ReconciledVehicle[]) {
  let omvOnly = 0;
  let dedicatedOnly = 0;
  let overlap = 0;
  const duplicateRelationships: Array<{ identityKey: string; sources: OceanSourceKey[] }> = [];

  for (const item of reconciled) {
    if (item.identityConflict) continue;
    const hasOmv = item.sources.includes("omv");
    const hasDedicated = item.sources.some((source) => DEDICATED_SOURCE_KEYS.includes(source));
    if (hasOmv && hasDedicated) {
      overlap += 1;
      duplicateRelationships.push({ identityKey: item.identityKey, sources: item.sources });
    } else if (hasOmv) {
      omvOnly += 1;
    } else if (hasDedicated) {
      dedicatedOnly += 1;
    }
  }

  return { omvOnly, dedicatedOnly, overlap, duplicateRelationships };
}

export function liveInsertBlockedReason(sourceResults: SourceListResult[]) {
  const failedRequired = sourceResults.filter(
    (result) => result.status === "failed" && DEDICATED_SOURCE_KEYS.includes(result.sourceKey),
  );
  if (failedRequired.length === 0) return null;
  return `Required source failed: ${failedRequired
    .map((result) => `${result.sourceKey} (${result.error ?? "unknown error"})`)
    .join("; ")}`;
}

export function omvLowerBoundWarning(sourceResults: SourceListResult[]) {
  const omv = sourceResults.find((result) => result.sourceKey === "omv");
  if (!omv || omv.status !== "failed") return null;
  return "Ocean Motor Village failed; unique total is a lower bound because OMV-only extras were not considered.";
}
