import { identityFor, vehicleContentHash } from "./identity";
import type { CanonicalVehicle, ReconciledVehicle, SourceListResult } from "./types";

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
    imageUrls: [...new Set(records.flatMap((record) => record.imageUrls))],
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
    const conflictReason = conflictingStableIds(group.records);
    if (conflictReason) {
      for (const [index, record] of group.records.entries()) {
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

    const merged = mergeVehicles(group.records);
    reconciled.push({
      identityKey,
      identityKind: group.kind,
      sources: [...new Set(group.records.map((record) => record.sourceKey))],
      preferredSource: merged.sourceKey,
      vehicle: merged,
      priceMismatch: pricesMismatch(group.records),
      identityConflict: false,
      conflictReason: null,
      contentHash: vehicleContentHash(merged),
    });
  }

  for (const [index, vehicle] of ungrouped.entries()) {
    reconciled.push({
      identityKey: `ungrouped:${vehicle.dealerKey}:${vehicle.sourceKey}:${index}`,
      identityKind: "composite",
      sources: [vehicle.sourceKey],
      preferredSource: vehicle.sourceKey,
      vehicle,
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
      contentHash: vehicleContentHash(vehicle),
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
