import { normalizeMakeLookupKey } from "@/lib/vehicle-catalogue/make-canonicalization";
import {
  normalizeVehicleMakeModel,
  normalizeVehicleModelLookupKey,
} from "@/lib/vehicle-catalogue/vehicle-normalization";

export interface VehicleInventoryRow {
  listingId: string;
  make: string | null;
  model: string | null;
}

export interface VehicleInventory {
  makes: Array<{ label: string; value: string; count: number }>;
  modelsByMake: Record<string, string[]>;
  modelCountsByMake: Record<string, Record<string, number>>;
}

export function vehicleInventoryRows(
  makeRows: ReadonlyArray<{ listingId: string; value: string }>,
  modelRows: ReadonlyArray<{ listingId: string; value: string }>,
): VehicleInventoryRow[] {
  const makes = new Map(makeRows.map((row) => [row.listingId, row.value]));
  const models = new Map(modelRows.map((row) => [row.listingId, row.value]));
  return [...new Set([...makes.keys(), ...models.keys()])].map((listingId) => ({
    listingId, make: makes.get(listingId) ?? null, model: models.get(listingId) ?? null,
  }));
}

export function buildVehicleInventory(rows: readonly VehicleInventoryRow[]): VehicleInventory {
  const makes = new Map<string, { name: string; count: number; models: Map<string, { name: string; count: number }> }>();
  for (const row of rows) {
    const identity = normalizeVehicleMakeModel(row.make, row.model);
    if (!identity.make) continue;
    const key = normalizeMakeLookupKey(identity.make);
    const previous = makes.get(key);
    const models = new Map(previous?.models);
    if (identity.model) {
      const modelKey = normalizeVehicleModelLookupKey(identity.make, identity.model);
      const previousModel = models.get(modelKey);
      models.set(modelKey, { name: previousModel?.name ?? identity.model, count: (previousModel?.count ?? 0) + 1 });
    }
    makes.set(key, { name: previous?.name ?? identity.make, count: (previous?.count ?? 0) + 1, models });
  }
  const sorted = [...makes.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    makes: sorted.map(({ name, count }) => ({ label: name, value: name, count })),
    modelsByMake: Object.fromEntries(sorted.map(({ name, models }) => [
      name, [...models.values()].map((model) => model.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    ])),
    modelCountsByMake: Object.fromEntries(sorted.map(({ name, models }) => [
      name, Object.fromEntries([...models.values()].map((model) => [model.name, model.count])),
    ])),
  };
}

/** Call only with rows selected through the caller's marketplace visibility policy. */
export function matchingVehicleListingIds(
  rows: readonly VehicleInventoryRow[],
  selection: { make?: string; model?: string },
): string[] {
  const requested = normalizeVehicleMakeModel(selection.make, selection.model);
  const makeKey = normalizeMakeLookupKey(requested.make ?? "");
  return rows.filter((row) => {
    const identity = normalizeVehicleMakeModel(row.make, row.model);
    if (selection.make && normalizeMakeLookupKey(identity.make ?? "") !== makeKey) return false;
    if (!selection.model) return true;
    const modelMake = selection.make ?? row.make;
    return normalizeVehicleModelLookupKey(identity.make, identity.model) ===
      normalizeVehicleModelLookupKey(modelMake, selection.model);
  }).map((row) => row.listingId);
}
