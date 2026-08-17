import { db } from "@/lib/db";
import { logAdminAction } from "@/lib/admin/audit";
import {
  VEHICLE_CATALOGUE_IMPORT_LIMITS,
  type VehicleCatalogueImport,
} from "@/lib/validations/vehicle-catalogue";
import { Prisma } from "@prisma/client";
import { normalizeCatalogueName } from "./normalize";

interface ExistingAlias {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
}

interface ExistingModel {
  id: string;
  makeId: string;
  name: string;
  normalizedName: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
  aliases: ExistingAlias[];
}

interface ExistingMake {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
  models: ExistingModel[];
}

export interface VehicleCatalogueDiff {
  creates: { makes: number; models: number; aliases: number };
  updates: { makes: number; models: number; aliases: number };
  deactivates: { makes: number; models: number; aliases: number };
  unchanged: { makes: number; models: number; aliases: number };
}

export const VEHICLE_CATALOGUE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 60_000,
} as const;

export class VehicleCatalogueImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VehicleCatalogueImportConflictError";
  }
}

export async function lockVehicleCatalogueTransaction(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(20260817014500)`,
  );
}

function emptyDiff(): VehicleCatalogueDiff {
  return {
    creates: { makes: 0, models: 0, aliases: 0 },
    updates: { makes: 0, models: 0, aliases: 0 },
    deactivates: { makes: 0, models: 0, aliases: 0 },
    unchanged: { makes: 0, models: 0, aliases: 0 },
  };
}

function assertSourceOwnership(
  existingMakes: ExistingMake[],
  payload: VehicleCatalogueImport,
) {
  const preserveExisting = payload.sourceMode === "preserve-existing";
  const makesByKey = new Map(
    existingMakes.map((make) => [make.normalizedName, make]),
  );

  for (const incomingMake of payload.makes) {
    const makeKey = normalizeCatalogueName(incomingMake.name);
    const existingMake = makesByKey.get(makeKey);
    if (!existingMake) continue;
    if (!preserveExisting && existingMake.source !== payload.source) {
      throw new VehicleCatalogueImportConflictError(
        `${incomingMake.name} is owned by source "${existingMake.source}" and cannot be reassigned by this import.`,
      );
    }

    const modelsByKey = new Map(
      existingMake.models.map((model) => [model.normalizedName, model]),
    );
    const namesByKey = new Map<
      string,
      { kind: "model" | "alias"; modelId: string; source: string }
    >();
    for (const model of existingMake.models) {
      namesByKey.set(model.normalizedName, {
        kind: "model",
        modelId: model.id,
        source: model.source,
      });
      for (const alias of model.aliases) {
        namesByKey.set(alias.normalizedName, {
          kind: "alias",
          modelId: model.id,
          source: alias.source,
        });
      }
    }

    for (const incomingModel of incomingMake.models) {
      const modelKey = normalizeCatalogueName(incomingModel.name);
      const existingModel = modelsByKey.get(modelKey);
      const existingName = namesByKey.get(modelKey);
      if (existingName?.kind === "alias") {
        throw new VehicleCatalogueImportConflictError(
          `${incomingMake.name} ${incomingModel.name} conflicts with an existing alias.`,
        );
      }
      if (
        !preserveExisting &&
        existingModel &&
        existingModel.source !== payload.source
      ) {
        throw new VehicleCatalogueImportConflictError(
          `${incomingMake.name} ${incomingModel.name} is owned by source "${existingModel.source}" and cannot be reassigned.`,
        );
      }

      for (const incomingAlias of incomingModel.aliases) {
        const aliasKey = normalizeCatalogueName(incomingAlias.name);
        const existingAliasName = namesByKey.get(aliasKey);
        if (
          existingAliasName &&
          (existingAliasName.kind !== "alias" ||
            existingAliasName.modelId !== existingModel?.id)
        ) {
          throw new VehicleCatalogueImportConflictError(
            `Alias "${incomingAlias.name}" conflicts with another model name for ${incomingMake.name}.`,
          );
        }
        if (
          !preserveExisting &&
          existingAliasName?.kind === "alias" &&
          existingAliasName.source !== payload.source
        ) {
          throw new VehicleCatalogueImportConflictError(
            `Alias "${incomingAlias.name}" is owned by source "${existingAliasName.source}" and cannot be reassigned.`,
          );
        }
      }
    }
  }
}

function isChanged(
  existing: {
    name: string;
    active: boolean;
    sortOrder: number;
    source: string;
    sourceVersion: string;
  },
  incoming: { name: string; active: boolean; sortOrder: number },
  metadata: Pick<
    VehicleCatalogueImport,
    "source" | "sourceVersion" | "sourceMode"
  >,
) {
  return (
    existing.name !== incoming.name ||
    existing.active !== incoming.active ||
    existing.sortOrder !== incoming.sortOrder ||
    (metadata.sourceMode === "strict" &&
      (existing.source !== metadata.source ||
        existing.sourceVersion !== metadata.sourceVersion))
  );
}

export function buildVehicleCatalogueDiff(
  existingMakes: ExistingMake[],
  payload: VehicleCatalogueImport,
): VehicleCatalogueDiff {
  const diff = emptyDiff();
  const existingMakeMap = new Map(
    existingMakes.map((make) => [make.normalizedName, make]),
  );
  const incomingMakeKeys = new Set<string>();

  for (const make of payload.makes) {
    const makeKey = normalizeCatalogueName(make.name);
    incomingMakeKeys.add(makeKey);
    const existingMake = existingMakeMap.get(makeKey);
    if (!existingMake) diff.creates.makes += 1;
    else if (isChanged(existingMake, make, payload)) diff.updates.makes += 1;
    else diff.unchanged.makes += 1;

    const existingModelMap = new Map(
      (existingMake?.models ?? []).map((model) => [model.normalizedName, model]),
    );
    const incomingModelKeys = new Set<string>();
    for (const model of make.models) {
      const modelKey = normalizeCatalogueName(model.name);
      incomingModelKeys.add(modelKey);
      const existingModel = existingModelMap.get(modelKey);
      if (!existingModel) diff.creates.models += 1;
      else if (isChanged(existingModel, model, payload)) diff.updates.models += 1;
      else diff.unchanged.models += 1;

      const existingAliasMap = new Map(
        (existingModel?.aliases ?? []).map((alias) => [
          alias.normalizedName,
          alias,
        ]),
      );
      const incomingAliasKeys = new Set<string>();
      for (const alias of model.aliases) {
        const aliasKey = normalizeCatalogueName(alias.name);
        incomingAliasKeys.add(aliasKey);
        const existingAlias = existingAliasMap.get(aliasKey);
        if (!existingAlias) diff.creates.aliases += 1;
        else if (isChanged(existingAlias, alias, payload)) diff.updates.aliases += 1;
        else diff.unchanged.aliases += 1;
      }
      if (payload.deactivateMissing) {
        diff.deactivates.aliases += (existingModel?.aliases ?? []).filter(
          (alias) =>
            alias.source === payload.source &&
            alias.active &&
            !incomingAliasKeys.has(alias.normalizedName),
        ).length;
      }
    }
    if (payload.deactivateMissing) {
      diff.deactivates.models += (existingMake?.models ?? []).filter(
        (model) =>
          model.source === payload.source &&
          model.active &&
          !incomingModelKeys.has(model.normalizedName),
      ).length;
    }
  }
  if (payload.deactivateMissing) {
    diff.deactivates.makes += existingMakes.filter(
      (make) =>
        make.source === payload.source &&
        make.active &&
        !incomingMakeKeys.has(make.normalizedName),
    ).length;
  }

  return diff;
}

type CatalogueReadClient =
  | Pick<Prisma.TransactionClient, "vehicleMake">
  | Pick<typeof db, "vehicleMake">;

async function readExistingCatalogue(
  where: Prisma.VehicleMakeWhereInput,
  client: CatalogueReadClient,
): Promise<ExistingMake[]> {
  return client.vehicleMake.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: VEHICLE_CATALOGUE_IMPORT_LIMITS.makes + 1,
    select: {
      id: true,
      name: true,
      normalizedName: true,
      active: true,
      sortOrder: true,
      source: true,
      sourceVersion: true,
      models: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake + 1,
        select: {
          id: true,
          makeId: true,
          name: true,
          normalizedName: true,
          active: true,
          sortOrder: true,
          source: true,
          sourceVersion: true,
          aliases: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            take: VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel + 1,
            select: {
              id: true,
              name: true,
              normalizedName: true,
              active: true,
              sortOrder: true,
              source: true,
              sourceVersion: true,
            },
          },
        },
      },
    },
  });
}

function assertCompleteCatalogueRead(rows: ExistingMake[], label: string) {
  if (rows.length > VEHICLE_CATALOGUE_IMPORT_LIMITS.makes) {
    throw new VehicleCatalogueImportConflictError(
      `${label} exceeds the ${VEHICLE_CATALOGUE_IMPORT_LIMITS.makes}-make safety limit. Split or clean up the source before importing.`,
    );
  }
  for (const make of rows) {
    if (
      make.models.length >
      VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake
    ) {
      throw new VehicleCatalogueImportConflictError(
        `${make.name} exceeds the ${VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake}-model safety limit. No changes were applied.`,
      );
    }
    for (const model of make.models) {
      if (
        model.aliases.length >
        VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel
      ) {
        throw new VehicleCatalogueImportConflictError(
          `${make.name} ${model.name} exceeds the ${VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel}-alias safety limit. No changes were applied.`,
        );
      }
    }
  }
}

async function getExistingCatalogue(
  payload: VehicleCatalogueImport,
  client: CatalogueReadClient = db,
): Promise<ExistingMake[]> {
  const incomingMakeKeys = payload.makes.map((make) =>
    normalizeCatalogueName(make.name),
  );
  const sourceRows = await readExistingCatalogue(
    { source: payload.source },
    client,
  );
  assertCompleteCatalogueRead(sourceRows, `Source "${payload.source}"`);

  const foreignRows = await readExistingCatalogue(
    {
      source: { not: payload.source },
      normalizedName: { in: incomingMakeKeys },
    },
    client,
  );
  assertCompleteCatalogueRead(foreignRows, "Incoming make set");

  const rowsByKey = new Map(
    [...sourceRows, ...foreignRows].map((make) => [
      make.normalizedName,
      make,
    ]),
  );
  return [...rowsByKey.values()].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
}

export async function previewVehicleCatalogueImport(
  payload: VehicleCatalogueImport,
) {
  const existing = await getExistingCatalogue(payload);
  assertSourceOwnership(existing, payload);
  return buildVehicleCatalogueDiff(existing, payload);
}

export async function applyVehicleCatalogueImport(
  payload: VehicleCatalogueImport,
  adminId: string,
) {
  return db.$transaction(async (transaction) => {
    await lockVehicleCatalogueTransaction(transaction);
    const existingMakes = await getExistingCatalogue(payload, transaction);
    assertSourceOwnership(existingMakes, payload);
    const preview = buildVehicleCatalogueDiff(existingMakes, payload);
    const existingMakesByKey = new Map(
      existingMakes.map((make) => [make.normalizedName, make]),
    );
    const incomingMakeKeys = payload.makes.map((make) =>
      normalizeCatalogueName(make.name),
    );

    const newMakes = payload.makes.filter(
      (make) => !existingMakesByKey.has(normalizeCatalogueName(make.name)),
    );
    if (newMakes.length > 0) {
      await transaction.vehicleMake.createMany({
        data: newMakes.map((make) => ({
          name: make.name,
          normalizedName: normalizeCatalogueName(make.name),
          active: make.active,
          sortOrder: make.sortOrder,
          source: payload.source,
          sourceVersion: payload.sourceVersion,
          importedAt: payload.importedAt,
        })),
      });
    }

    for (const make of payload.makes) {
      const existingMake = existingMakesByKey.get(
        normalizeCatalogueName(make.name),
      );
      if (!existingMake || !isChanged(existingMake, make, payload)) continue;
      await transaction.vehicleMake.update({
        where: { id: existingMake.id },
        data: {
          name: make.name,
          active: make.active,
          sortOrder: make.sortOrder,
          ...(payload.sourceMode === "strict"
            ? {
                sourceVersion: payload.sourceVersion,
                importedAt: payload.importedAt,
              }
            : {}),
        },
      });
    }

    const makeRows = await transaction.vehicleMake.findMany({
      where: { normalizedName: { in: incomingMakeKeys } },
      select: { id: true, normalizedName: true },
    });
    const makeIdsByKey = new Map(
      makeRows.map((make) => [make.normalizedName, make.id]),
    );

    const newModels: Prisma.VehicleModelCreateManyInput[] = [];
    for (const make of payload.makes) {
      const makeKey = normalizeCatalogueName(make.name);
      const makeId = makeIdsByKey.get(makeKey);
      if (!makeId) {
        throw new VehicleCatalogueImportConflictError(
          `Could not resolve imported make "${make.name}".`,
        );
      }
      const existingModelsByKey = new Map(
        (existingMakesByKey.get(makeKey)?.models ?? []).map((model) => [
          model.normalizedName,
          model,
        ]),
      );
      for (const model of make.models) {
        const modelKey = normalizeCatalogueName(model.name);
        const existingModel = existingModelsByKey.get(modelKey);
        if (existingModel && isChanged(existingModel, model, payload)) {
          await transaction.vehicleModel.update({
            where: { id: existingModel.id },
            data: {
              name: model.name,
              active: model.active,
              sortOrder: model.sortOrder,
              ...(payload.sourceMode === "strict"
                ? {
                    sourceVersion: payload.sourceVersion,
                    importedAt: payload.importedAt,
                  }
                : {}),
            },
          });
        } else if (!existingModel) {
          newModels.push({
            makeId,
            name: model.name,
            normalizedName: modelKey,
            active: model.active,
            sortOrder: model.sortOrder,
            source: payload.source,
            sourceVersion: payload.sourceVersion,
            importedAt: payload.importedAt,
          });
        }
      }
    }
    if (newModels.length > 0) {
      await transaction.vehicleModel.createMany({ data: newModels });
    }

    const modelRows = await transaction.vehicleModel.findMany({
      where: { makeId: { in: makeRows.map((make) => make.id) } },
      select: { id: true, makeId: true, normalizedName: true },
    });
    const modelIdsByKey = new Map(
      modelRows.map((model) => [
        `${model.makeId}:${model.normalizedName}`,
        model.id,
      ]),
    );
    const newAliases: Prisma.VehicleModelAliasCreateManyInput[] = [];
    for (const make of payload.makes) {
      const makeKey = normalizeCatalogueName(make.name);
      const makeId = makeIdsByKey.get(makeKey);
      if (!makeId) continue;
      const existingModelsByKey = new Map(
        (existingMakesByKey.get(makeKey)?.models ?? []).map((model) => [
          model.normalizedName,
          model,
        ]),
      );
      for (const model of make.models) {
        const modelKey = normalizeCatalogueName(model.name);
        const modelId = modelIdsByKey.get(`${makeId}:${modelKey}`);
        if (!modelId) {
          throw new VehicleCatalogueImportConflictError(
            `Could not resolve imported model "${make.name} ${model.name}".`,
          );
        }
        const existingAliasesByKey = new Map(
          (existingModelsByKey.get(modelKey)?.aliases ?? []).map((alias) => [
            alias.normalizedName,
            alias,
          ]),
        );
        const incomingAliasKeys = model.aliases.map((alias) =>
          normalizeCatalogueName(alias.name),
        );
        for (const alias of model.aliases) {
          const aliasKey = normalizeCatalogueName(alias.name);
          const existingAlias = existingAliasesByKey.get(aliasKey);
          if (existingAlias && isChanged(existingAlias, alias, payload)) {
            await transaction.vehicleModelAlias.update({
              where: { id: existingAlias.id },
              data: {
                name: alias.name,
                active: alias.active,
                sortOrder: alias.sortOrder,
                ...(payload.sourceMode === "strict"
                  ? {
                      sourceVersion: payload.sourceVersion,
                      importedAt: payload.importedAt,
                    }
                  : {}),
              },
            });
          } else if (!existingAlias) {
            newAliases.push({
              makeId,
              modelId,
              name: alias.name,
              normalizedName: aliasKey,
              active: alias.active,
              sortOrder: alias.sortOrder,
              source: payload.source,
              sourceVersion: payload.sourceVersion,
              importedAt: payload.importedAt,
            });
          }
        }
        if (payload.deactivateMissing) {
          await transaction.vehicleModelAlias.updateMany({
            where: {
              modelId,
              source: payload.source,
              active: true,
              ...(incomingAliasKeys.length
                ? { normalizedName: { notIn: incomingAliasKeys } }
                : {}),
            },
            data: { active: false },
          });
        }
      }

      if (payload.deactivateMissing) {
        const incomingModelKeys =
          payload.makes
            .find(
              (candidate) =>
                normalizeCatalogueName(candidate.name) === makeKey,
            )
            ?.models.map((model) => normalizeCatalogueName(model.name)) ?? [];
        await transaction.vehicleModel.updateMany({
          where: {
            makeId,
            source: payload.source,
            active: true,
            ...(incomingModelKeys.length
              ? { normalizedName: { notIn: incomingModelKeys } }
              : {}),
          },
          data: { active: false },
        });
      }
    }
    if (newAliases.length > 0) {
      await transaction.vehicleModelAlias.createMany({ data: newAliases });
    }

    if (payload.deactivateMissing) {
      await transaction.vehicleMake.updateMany({
        where: {
          source: payload.source,
          active: true,
          normalizedName: { notIn: incomingMakeKeys },
        },
        data: { active: false },
      });
    }

    await logAdminAction(
      {
        adminId,
        action: "IMPORT_VEHICLE_CATALOGUE",
        entityType: "VehicleCatalogue",
        details: {
          source: payload.source,
          sourceVersion: payload.sourceVersion,
          importedAt: payload.importedAt.toISOString(),
          deactivateMissing: payload.deactivateMissing,
          diff: preview,
        },
      },
      transaction,
    );
    return preview;
  }, VEHICLE_CATALOGUE_TRANSACTION_OPTIONS);
}
