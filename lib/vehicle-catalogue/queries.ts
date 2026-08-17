import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { normalizeMakeLookupKey } from "./make-canonicalization";

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
    }),
  ["vehicle-catalogue-active-makes-v1"],
  { tags: ["vehicle-catalogue"], revalidate: 3_600 },
);

const getCachedActiveModelsByNormalizedMake = unstable_cache(
  async (normalizedMake: string): Promise<VehicleModelOption[]> => {
    const rows = await db.vehicleModel.findMany({
      where: {
        active: true,
        make: { active: true, normalizedName: normalizedMake },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: VEHICLE_MODEL_LIMIT,
      select: {
        id: true,
        name: true,
        aliases: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          take: 20,
          select: { name: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      aliases: row.aliases.map((alias) => alias.name),
    }));
  },
  ["vehicle-catalogue-active-models-v1"],
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
