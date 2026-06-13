import { getMakes, getModels } from "@meterapp/vehicle-db";
import { VEHICLE_MAKES } from "@/lib/constants/vehicle-makes";

function normalizeVehicleKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeVehicleKey(trimmed);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, trimmed);
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function getKnownVehicleModelsByMake(
  marketplaceModelsByMake: Record<string, string[]> = {}
): Record<string, string[]> {
  const sourceMakesByKey = new Map<string, number[]>();
  for (const make of getMakes()) {
    const key = normalizeVehicleKey(make.makeName);
    const makeIds = sourceMakesByKey.get(key) ?? [];
    makeIds.push(make.makeId);
    sourceMakesByKey.set(key, makeIds);
  }

  return Object.fromEntries(
    VEHICLE_MAKES.map((make) => {
      const sourceMakeIds = sourceMakesByKey.get(normalizeVehicleKey(make)) ?? [];
      const sourceModels = sourceMakeIds.flatMap((makeId) =>
        getModels({ makeId }).map((model) => model.modelName)
      );

      return [
        make,
        uniqueSorted([
          ...sourceModels,
          ...(marketplaceModelsByMake[make] ?? []),
        ]),
      ];
    })
  );
}
