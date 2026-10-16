import { classifyLocation } from "../import-ocean-inventory/locations";
import { identityFor, vehicleContentHash } from "./identity";
import { uniqueImageUrls } from "./image-urls";
import type { CanonicalVehicle, ReconciledVehicle, SourceListResult } from "./types";

const OCEAN_DEALER_KEY = "ocean-motor-village";

export type OceanScopeDecision =
  | { kind: "include"; canonical: string }
  | { kind: "exclude"; reason: string }
  | { kind: "unknown"; reason: string };

export function classifyOceanScope(locationName: string | null | undefined): OceanScopeDecision {
  const decision = classifyLocation(locationName);
  if (decision.kind === "include") return { kind: "include", canonical: decision.canonical };
  if (decision.reason.startsWith("excluded-location:")) {
    return { kind: "exclude", reason: decision.reason };
  }
  const label = locationName?.trim() || "missing-location";
  return { kind: "unknown", reason: `unknown-ocean-location:${label}` };
}

function withCanonicalOceanLocation(vehicle: CanonicalVehicle): CanonicalVehicle {
  if (vehicle.dealerKey !== OCEAN_DEALER_KEY) return vehicle;
  const scope = classifyOceanScope(vehicle.locationName);
  if (scope.kind !== "include") return vehicle;
  return { ...vehicle, locationName: scope.canonical };
}

function recordsForOceanScope(records: CanonicalVehicle[]): CanonicalVehicle[] | null {
  const ocean = records.filter((record) => record.dealerKey === OCEAN_DEALER_KEY);
  if (ocean.length === 0) return records;
  const kinds = new Set(ocean.map((record) => classifyOceanScope(record.locationName).kind));
  if (kinds.size !== 1 || !kinds.has("include")) return null;
  return records.map(withCanonicalOceanLocation);
}

export function oceanScopeBlockers(sourceResults: SourceListResult[]) {
  const reasons = new Set<string>();
  const groups = new Map<string, { kinds: Set<OceanScopeDecision["kind"]>; labels: Set<string> }>();

  for (const result of sourceResults) {
    if (result.status !== "ok") continue;
    for (const vehicle of result.vehicles) {
      if (vehicle.dealerKey !== OCEAN_DEALER_KEY) continue;
      const scope = classifyOceanScope(vehicle.locationName);
      if (scope.kind === "unknown") reasons.add(scope.reason);
      const identity = identityFor(vehicle);
      const key = identity?.key ?? `ungrouped:${vehicle.sourceKey}:${vehicle.detailUrl ?? ""}`;
      const group = groups.get(key) ?? { kinds: new Set(), labels: new Set<string>() };
      group.kinds.add(scope.kind);
      group.labels.add(vehicle.locationName?.trim() || "missing-location");
      groups.set(key, group);
    }
  }

  for (const group of groups.values()) {
    if (group.kinds.has("include") && group.kinds.has("exclude")) {
      reasons.add(`ambiguous-ocean-location:${[...group.labels].sort().join(" | ")}`);
    }
  }

  return [...reasons].sort();
}

export function guardOceanScope(sourceResults: SourceListResult[]) {
  const blockers = oceanScopeBlockers(sourceResults);
  if (blockers.length === 0) return { sourceResults, blocked: false };
  const error = blockers.join("; ");
  return {
    blocked: true,
    sourceResults: sourceResults.map((source) => {
      const oceanSource =
        source.dealerKey === OCEAN_DEALER_KEY ||
        source.vehicles.some((vehicle) => vehicle.dealerKey === OCEAN_DEALER_KEY);
      if (!oceanSource || source.status !== "ok") return source;
      return { ...source, status: "failed" as const, error };
    }),
  };
}

function completeness(vehicle: CanonicalVehicle) {
  return (
    vehicle.imageUrls.length * 3 +
    vehicle.description.trim().length +
    (vehicle.year != null ? 25 : 0) +
    (vehicle.mileage != null ? 25 : 0) +
    (vehicle.pricePence != null ? 15 : 0) +
    (vehicle.fuel ? 5 : 0) +
    (vehicle.transmission ? 5 : 0) +
    (vehicle.bodyType ? 5 : 0) +
    (vehicle.colour ? 5 : 0) +
    (vehicle.vin ? 10 : 0) +
    (vehicle.registration ? 8 : 0)
  );
}

function preferVehicle(left: CanonicalVehicle, right: CanonicalVehicle) {
  return completeness(right) > completeness(left) ? right : left;
}

function mergeVehicles(records: CanonicalVehicle[]): CanonicalVehicle {
  const preferred = records.reduce((best, current) => preferVehicle(best, current));
  const sourceKeys = [...new Set(records.flatMap((record) => record.provenance.sourceKeys))];
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
    description:
      records.slice().sort((left, right) => right.description.length - left.description.length)[0]
        ?.description ?? preferred.description,
    imageUrls: uniqueImageUrls(records.flatMap((record) => record.imageUrls), 99),
    fuel: preferred.fuel ?? records.find((record) => record.fuel)?.fuel ?? null,
    transmission:
      preferred.transmission ?? records.find((record) => record.transmission)?.transmission ?? null,
    bodyType: preferred.bodyType ?? records.find((record) => record.bodyType)?.bodyType ?? null,
    colour: preferred.colour ?? records.find((record) => record.colour)?.colour ?? null,
    vin: preferred.vin ?? records.find((record) => record.vin)?.vin ?? null,
    registration:
      preferred.registration ?? records.find((record) => record.registration)?.registration ?? null,
    provenance: {
      ...preferred.provenance,
      sourceKeys,
    },
  };
}

function pricesMismatch(records: CanonicalVehicle[]) {
  const prices = records
    .map((record) => record.pricePence)
    .filter((price): price is number => price != null);
  if (prices.length < 2) return false;
  return Math.max(...prices) - Math.min(...prices) > 100;
}

function conflictingStableIds(records: CanonicalVehicle[]) {
  const vins = new Set(records.map((record) => record.vin).filter(Boolean));
  const regs = new Set(records.map((record) => record.registration).filter(Boolean));
  if (vins.size > 1) return `conflicting VINs: ${[...vins].join(", ")}`;
  if (regs.size > 1) return `conflicting registrations: ${[...regs].join(", ")}`;
  return null;
}

export function reconcileDealerVehicles(sourceResults: SourceListResult[]): ReconciledVehicle[] {
  const groups = new Map<string, { kind: ReconciledVehicle["identityKind"]; records: CanonicalVehicle[] }>();
  const ungrouped: CanonicalVehicle[] = [];

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
    const scopedRecords = recordsForOceanScope(group.records);
    if (!scopedRecords) continue;
    const conflictReason = conflictingStableIds(scopedRecords);
    if (conflictReason) {
      for (const [index, record] of scopedRecords.entries()) {
        reconciled.push({
          identityKey: `${identityKey}#keep-${index}`,
          identityKind: group.kind,
          sources: [record.sourceKey],
          preferredSource: record.sourceKey,
          vehicle: record,
          priceMismatch: false,
          identityConflict: true,
          conflictReason,
          contentHash: vehicleContentHash(record),
        });
      }
      continue;
    }

    const merged = mergeVehicles(scopedRecords);
    reconciled.push({
      identityKey,
      identityKind: group.kind,
      sources: [...new Set(scopedRecords.map((record) => record.sourceKey))],
      preferredSource: merged.sourceKey,
      vehicle: merged,
      priceMismatch: pricesMismatch(scopedRecords),
      identityConflict: false,
      conflictReason: null,
      contentHash: vehicleContentHash(merged),
    });
  }

  for (const [index, vehicle] of ungrouped.entries()) {
    const scoped = recordsForOceanScope([vehicle]);
    const eligible = scoped?.[0];
    if (!eligible) continue;
    reconciled.push({
      identityKey: `ungrouped:${eligible.dealerKey}:${eligible.sourceKey}:${index}`,
      identityKind: "composite",
      sources: [eligible.sourceKey],
      preferredSource: eligible.sourceKey,
      vehicle: eligible,
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
      contentHash: vehicleContentHash(eligible),
    });
  }

  return reconciled;
}

export function successfulRawCount(sourceResults: SourceListResult[]) {
  return sourceResults
    .filter((result) => result.status === "ok")
    .reduce((sum, result) => sum + (result.rawCount ?? result.vehicles.length), 0);
}

export function reconcileSourceCounts(sourceResults: SourceListResult[]) {
  const errors: string[] = [];
  for (const result of sourceResults) {
    if (result.status !== "ok") continue;
    const retrieved = result.vehicles.length;
    if (result.rawCount != null && result.rawCount !== retrieved) {
      errors.push(
        `${result.sourceKey}: rawCount ${result.rawCount} != retrieved ${retrieved}`,
      );
    }
    if (result.advertisedCount != null && retrieved < result.advertisedCount) {
      errors.push(
        `${result.sourceKey}: retrieved ${retrieved} < advertised ${result.advertisedCount}`,
      );
    }
  }
  return errors;
}
