import { db } from "@/lib/db";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";
import { cleanCatalogueName, normalizeCatalogueName } from "./normalize";
import { normalizeMakeLookupKey } from "./make-canonicalization";

export interface CatalogueIdentity {
  make: string | null;
  model: string | null;
  makeMatched: boolean;
  modelMatched: boolean;
}

export interface CatalogueIdentityLookup {
  findMake(normalizedName: string): Promise<{ name: string; normalizedName: string } | null>;
  findModel(
    makeNormalizedName: string,
    modelNormalizedName: string,
  ): Promise<{ name: string } | null>;
}

const databaseLookup: CatalogueIdentityLookup = {
  findMake(normalizedName) {
    return db.vehicleMake.findUnique({
      where: { normalizedName, active: true },
      select: { name: true, normalizedName: true },
    });
  },
  findModel(makeNormalizedName, modelNormalizedName) {
    return db.vehicleModel.findFirst({
      where: {
        active: true,
        make: { active: true, normalizedName: makeNormalizedName },
        OR: [
          { normalizedName: modelNormalizedName },
          {
            aliases: {
              some: { active: true, normalizedName: modelNormalizedName },
            },
          },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    });
  },
};

export async function normalizeVehicleIdentity(
  rawMake: string | null,
  rawModel: string | null,
  lookup: CatalogueIdentityLookup = databaseLookup,
): Promise<CatalogueIdentity> {
  const cleanedMake = rawMake ? cleanCatalogueName(rawMake) : null;
  const cleanedModel = rawModel ? cleanCatalogueName(rawModel) : null;
  const makeKey = cleanedMake ? normalizeMakeLookupKey(cleanedMake) : "";
  const modelKey = cleanedModel ? normalizeCatalogueName(cleanedModel) : "";

  const [makeRow, candidateModel] = await Promise.all([
    makeKey ? lookup.findMake(makeKey) : Promise.resolve(null),
    makeKey && modelKey
      ? lookup.findModel(makeKey, modelKey)
      : Promise.resolve(null),
  ]);
  const modelRow = makeRow ? candidateModel : null;

  return {
    make: makeRow?.name ?? cleanedMake,
    model: modelRow?.name ?? cleanedModel,
    makeMatched: Boolean(makeRow),
    modelMatched: Boolean(modelRow),
  };
}

export async function normalizeVehicleCheckCatalogue(
  result: VehicleCheckResult,
): Promise<VehicleCheckResult> {
  const rawMake = result.vehicle?.make ?? result.motHistory?.make ?? null;
  const rawModel = result.vehicle?.model ?? result.motHistory?.model ?? null;
  const identity = await normalizeVehicleIdentity(rawMake, rawModel);

  if (!identity.make && !identity.model) return result;

  return {
    ...result,
    vehicle: result.vehicle
      ? {
          ...result.vehicle,
          make: identity.make ?? result.vehicle.make,
          model: identity.model ?? result.vehicle.model,
        }
      : result.vehicle,
    motHistory: result.motHistory
      ? {
          ...result.motHistory,
          make: identity.make ?? result.motHistory.make,
          model: identity.model ?? result.motHistory.model,
        }
      : result.motHistory,
  };
}
