import { canonicalizeKnownMake, normalizeMakeLookupKey } from "./make-canonicalization";
import {
  isUnassignedVehicleModel,
  normalizeVehicleMakeModel,
  normalizeVehicleModelLookupKey,
} from "./vehicle-normalization";
import type { VehicleMakeOption, VehicleModelOption } from "./queries";

export function canonicalMakeOptions(rows: readonly VehicleMakeOption[]): VehicleMakeOption[] {
  const makes = new Map<string, VehicleMakeOption>();
  for (const row of rows) {
    const name = canonicalizeKnownMake(row.name);
    if (!name) continue;
    const normalizedName = normalizeMakeLookupKey(name);
    if (!makes.has(normalizedName)) makes.set(normalizedName, { ...row, name, normalizedName });
  }
  return [...makes.values()];
}

export function canonicalModelOptions(
  make: string,
  rows: ReadonlyArray<VehicleModelOption & { make?: { name: string } }>,
): VehicleModelOption[] {
  const models = new Map<string, VehicleModelOption>();
  for (const row of rows) {
    const rawMake = row.make?.name ?? make;
    const name = normalizeVehicleMakeModel(rawMake, row.name).model;
    if (!name) continue;
    const key = normalizeVehicleModelLookupKey(make, name);
    const previous = models.get(key);
    const aliases = [...new Set([...(previous?.aliases ?? []), row.name, ...row.aliases])]
      .filter((alias) => !isUnassignedVehicleModel(alias) &&
        normalizeVehicleModelLookupKey(rawMake, alias) === key);
    models.set(key, { id: previous?.id ?? row.id, name: previous?.name ?? name, aliases });
  }
  return [...models.values()];
}
