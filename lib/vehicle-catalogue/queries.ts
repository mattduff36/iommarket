import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { makeCatalogueLookupKeys, normalizeMakeLookupKey } from "./make-canonicalization";
import { canonicalMakeOptions, canonicalModelOptions } from "./options";

export const VEHICLE_MAKE_LIMIT = 250;
export const VEHICLE_MODEL_LIMIT = 300;

export interface VehicleMakeOption {
  id: string;
  name: string;
  normalizedName: string;
}

export interface VehicleModelOption {
  id: string;
  name: string;
  aliases: string[];
}

export const getActiveVehicleMakes = unstable_cache(
  async (): Promise<VehicleMakeOption[]> =>
    db.vehicleMake.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: VEHICLE_MAKE_LIMIT,
      select: { id: true, name: true, normalizedName: true },
    }).then(canonicalMakeOptions),
  ["vehicle-catalogue-active-makes-v2"],
  { tags: ["vehicle-catalogue"], revalidate: 3_600 },
);

const getCachedActiveModelsByNormalizedMake = unstable_cache(
  async (normalizedMake: string): Promise<VehicleModelOption[]> => {
    const makeKeys = makeCatalogueLookupKeys(normalizedMake);
    const rows = await db.vehicleModel.findMany({
      where: {
        active: true,
        make: {
          active: true,
          normalizedName: makeKeys.length === 1 ? makeKeys[0] : { in: makeKeys },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: VEHICLE_MODEL_LIMIT,
      select: {
        id: true,
        name: true,
        make: { select: { name: true } },
        aliases: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          take: 20,
          select: { name: true },
        },
      },
    });

    return canonicalModelOptions(normalizedMake, rows.map((row) => ({
      id: row.id,
      name: row.name,
      aliases: row.aliases.map((alias) => alias.name),
      make: row.make,
    })));
  },
  ["vehicle-catalogue-active-models-v2"],
  { tags: ["vehicle-catalogue"], revalidate: 3_600 },
);

export async function getActiveModelsByMake(
  makeValue: string,
): Promise<VehicleModelOption[]> {
  const normalizedMake = normalizeMakeLookupKey(makeValue);
  if (!normalizedMake) return [];

  const makes = await getActiveVehicleMakes();
  if (!makes.some((make) => make.normalizedName === normalizedMake)) {
    return [];
  }

  return getCachedActiveModelsByNormalizedMake(normalizedMake);
}
