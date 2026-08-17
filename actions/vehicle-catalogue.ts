"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  VEHICLE_CATALOGUE_IMPORT_LIMITS,
  vehicleAliasMutationSchema,
  vehicleCatalogueImportRequestSchema,
  vehicleCatalogueImportSchema,
  vehicleMakeMutationSchema,
  vehicleModelMutationSchema,
  type VehicleAliasMutation,
  type VehicleMakeMutation,
  type VehicleModelMutation,
} from "@/lib/validations/vehicle-catalogue";
import {
  applyVehicleCatalogueImport,
  lockVehicleCatalogueTransaction,
  previewVehicleCatalogueImport,
  VehicleCatalogueImportConflictError,
} from "@/lib/vehicle-catalogue/import";
import {
  cleanCatalogueName,
  normalizeCatalogueName,
} from "@/lib/vehicle-catalogue/normalize";
import { Prisma } from "@prisma/client";
import { reportHandledException } from "@/lib/monitoring";

function refreshCatalogue() {
  revalidateTag("vehicle-catalogue", "max");
  revalidatePath("/admin/vehicle-catalogue");
}

function errorMessage(error: unknown) {
  if (error instanceof VehicleCatalogueImportConflictError) {
    return error.message;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "That normalized vehicle name is already in use for this make.";
  }
  return "Vehicle catalogue update failed. No changes were applied.";
}

async function reportUnexpectedCatalogueFailure(
  error: unknown,
  action: string,
  adminId: string,
) {
  if (
    error instanceof VehicleCatalogueImportConflictError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002")
  ) {
    return;
  }
  await reportHandledException({
    error,
    action,
    route: "actions/vehicle-catalogue",
    userId: adminId,
    tags: { feature: "vehicle-catalogue" },
  });
}

export async function saveVehicleMake(input: VehicleMakeMutation) {
  const admin = await requireRole("ADMIN");
  const parsed = vehicleMakeMutationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const { id, name: rawName, ...data } = parsed.data;
  const name = cleanCatalogueName(rawName);
  try {
    const make = await db.$transaction(async (transaction) => {
      await lockVehicleCatalogueTransaction(transaction);
      if (id) {
        const existing = await transaction.vehicleMake.findUnique({
          where: { id },
          select: { source: true },
        });
        if (!existing) {
          throw new VehicleCatalogueImportConflictError(
            "Vehicle make no longer exists.",
          );
        }
        if (existing.source !== data.source) {
          throw new VehicleCatalogueImportConflictError(
            `Source ownership is "${existing.source}" and cannot be changed here.`,
          );
        }
      }
      const saved = id
        ? await transaction.vehicleMake.update({
            where: { id },
            data: {
              ...data,
              name,
              normalizedName: normalizeCatalogueName(name),
              importedAt: new Date(),
            },
          })
        : await transaction.vehicleMake.create({
            data: {
              ...data,
              name,
              normalizedName: normalizeCatalogueName(name),
              importedAt: new Date(),
            },
          });
      await logAdminAction(
        {
          adminId: admin.id,
          action: id ? "UPDATE_VEHICLE_MAKE" : "CREATE_VEHICLE_MAKE",
          entityType: "VehicleMake",
          entityId: saved.id,
          details: { active: saved.active, sortOrder: saved.sortOrder },
        },
        transaction,
      );
      return saved;
    });
    refreshCatalogue();
    return { data: make };
  } catch (error) {
    await reportUnexpectedCatalogueFailure(
      error,
      "saveVehicleMake",
      admin.id,
    );
    return { error: errorMessage(error) };
  }
}

export async function saveVehicleModel(input: VehicleModelMutation) {
  const admin = await requireRole("ADMIN");
  const parsed = vehicleModelMutationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const { id, name: rawName, ...data } = parsed.data;
  const name = cleanCatalogueName(rawName);
  try {
    const model = await db.$transaction(async (transaction) => {
      await lockVehicleCatalogueTransaction(transaction);
      const normalizedName = normalizeCatalogueName(name);
      if (id) {
        const existing = await transaction.vehicleModel.findUnique({
          where: { id },
          select: { source: true, makeId: true },
        });
        if (!existing) {
          throw new VehicleCatalogueImportConflictError(
            "Vehicle model no longer exists.",
          );
        }
        if (existing.source !== data.source) {
          throw new VehicleCatalogueImportConflictError(
            `Source ownership is "${existing.source}" and cannot be changed here.`,
          );
        }
        if (existing.makeId !== data.makeId) {
          throw new VehicleCatalogueImportConflictError(
            "Models cannot be moved between makes; deactivate and recreate it instead.",
          );
        }
      }
      const aliasConflict = await transaction.vehicleModelAlias.findUnique({
        where: {
          makeId_normalizedName: {
            makeId: data.makeId,
            normalizedName,
          },
        },
        select: { id: true },
      });
      if (aliasConflict) {
        throw new VehicleCatalogueImportConflictError(
          "That model name is already used as an alias for this make.",
        );
      }
      const saved = id
        ? await transaction.vehicleModel.update({
            where: { id },
            data: {
              ...data,
              name,
              normalizedName,
              importedAt: new Date(),
            },
          })
        : await transaction.vehicleModel.create({
            data: {
              ...data,
              name,
              normalizedName,
              importedAt: new Date(),
            },
          });
      await logAdminAction(
        {
          adminId: admin.id,
          action: id ? "UPDATE_VEHICLE_MODEL" : "CREATE_VEHICLE_MODEL",
          entityType: "VehicleModel",
          entityId: saved.id,
          details: {
            makeId: saved.makeId,
            active: saved.active,
            sortOrder: saved.sortOrder,
          },
        },
        transaction,
      );
      return saved;
    });
    refreshCatalogue();
    return { data: model };
  } catch (error) {
    await reportUnexpectedCatalogueFailure(
      error,
      "saveVehicleModel",
      admin.id,
    );
    return { error: errorMessage(error) };
  }
}

export async function saveVehicleModelAlias(input: VehicleAliasMutation) {
  const admin = await requireRole("ADMIN");
  const parsed = vehicleAliasMutationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const { id, name: rawName, ...data } = parsed.data;
  const name = cleanCatalogueName(rawName);
  try {
    const alias = await db.$transaction(async (transaction) => {
      await lockVehicleCatalogueTransaction(transaction);
      const normalizedName = normalizeCatalogueName(name);
      const targetModel = await transaction.vehicleModel.findUnique({
        where: { id: data.modelId },
        select: { makeId: true },
      });
      if (!targetModel) {
        throw new VehicleCatalogueImportConflictError(
          "The target vehicle model no longer exists.",
        );
      }
      if (id) {
        const existing = await transaction.vehicleModelAlias.findUnique({
          where: { id },
          select: { source: true, modelId: true },
        });
        if (!existing) {
          throw new VehicleCatalogueImportConflictError(
            "Vehicle model alias no longer exists.",
          );
        }
        if (existing.source !== data.source) {
          throw new VehicleCatalogueImportConflictError(
            `Source ownership is "${existing.source}" and cannot be changed here.`,
          );
        }
        if (existing.modelId !== data.modelId) {
          throw new VehicleCatalogueImportConflictError(
            "Aliases cannot be moved between models; deactivate and recreate it instead.",
          );
        }
      }
      const modelConflict = await transaction.vehicleModel.findUnique({
        where: {
          makeId_normalizedName: {
            makeId: targetModel.makeId,
            normalizedName,
          },
        },
        select: { id: true },
      });
      if (modelConflict) {
        throw new VehicleCatalogueImportConflictError(
          "That alias is already used as a model name for this make.",
        );
      }
      const saved = id
        ? await transaction.vehicleModelAlias.update({
            where: { id },
            data: {
              ...data,
              name,
              normalizedName,
              importedAt: new Date(),
            },
          })
        : await transaction.vehicleModelAlias.create({
            data: {
              ...data,
              makeId: targetModel.makeId,
              name,
              normalizedName,
              importedAt: new Date(),
            },
          });
      await logAdminAction(
        {
          adminId: admin.id,
          action: id
            ? "UPDATE_VEHICLE_MODEL_ALIAS"
            : "CREATE_VEHICLE_MODEL_ALIAS",
          entityType: "VehicleModelAlias",
          entityId: saved.id,
          details: {
            modelId: saved.modelId,
            active: saved.active,
            sortOrder: saved.sortOrder,
          },
        },
        transaction,
      );
      return saved;
    });
    refreshCatalogue();
    return { data: alias };
  } catch (error) {
    await reportUnexpectedCatalogueFailure(
      error,
      "saveVehicleModelAlias",
      admin.id,
    );
    return { error: errorMessage(error) };
  }
}

export async function importVehicleCatalogue(input: {
  json: string;
  dryRun: boolean;
  confirmDeactivateMissing?: boolean;
}) {
  const admin = await requireRole("ADMIN");
  const request = vehicleCatalogueImportRequestSchema.safeParse(input);
  if (!request.success) return { error: request.error.flatten().fieldErrors };

  let json: unknown;
  try {
    json = JSON.parse(request.data.json);
  } catch {
    return { error: "Import must be valid JSON." };
  }
  const payload = vehicleCatalogueImportSchema.safeParse(json);
  if (!payload.success) {
    return { error: payload.error.flatten().fieldErrors };
  }
  if (
    !request.data.dryRun &&
    payload.data.deactivateMissing &&
    !request.data.confirmDeactivateMissing
  ) {
    return {
      error:
        "Confirm deactivation after reviewing a dry-run before applying this import.",
    };
  }

  try {
    const diff = request.data.dryRun
      ? await previewVehicleCatalogueImport(payload.data)
      : await applyVehicleCatalogueImport(payload.data, admin.id);
    if (!request.data.dryRun) refreshCatalogue();
    return { data: { dryRun: request.data.dryRun, diff } };
  } catch (error) {
    await reportUnexpectedCatalogueFailure(
      error,
      request.data.dryRun
        ? "previewVehicleCatalogueImport"
        : "applyVehicleCatalogueImport",
      admin.id,
    );
    return { error: errorMessage(error) };
  }
}

export async function exportVehicleCatalogue() {
  const admin = await requireRole("ADMIN");
  try {
    const makes = await db.vehicleMake.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: VEHICLE_CATALOGUE_IMPORT_LIMITS.makes + 1,
      include: {
        models: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          take: VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake + 1,
          include: {
            aliases: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              take: VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel + 1,
            },
          },
        },
      },
    });
    if (makes.length > VEHICLE_CATALOGUE_IMPORT_LIMITS.makes) {
      throw new VehicleCatalogueImportConflictError(
        "Catalogue export exceeds the safe make limit. No partial export was created.",
      );
    }
    for (const make of makes) {
      if (
        make.models.length >
        VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake
      ) {
        throw new VehicleCatalogueImportConflictError(
          `${make.name} exceeds the safe model limit. No partial export was created.`,
        );
      }
      if (
        make.models.some(
          (model) =>
            model.aliases.length >
            VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel,
        )
      ) {
        throw new VehicleCatalogueImportConflictError(
          `${make.name} exceeds the safe alias limit. No partial export was created.`,
        );
      }
    }
    const latest = makes.reduce<Date | null>(
      (current, make) =>
        !current || make.importedAt > current ? make.importedAt : current,
      null,
    );
    return {
      data: {
        source: "iommarket-export",
        sourceVersion: latest?.toISOString() ?? "empty",
        sourceMode: "preserve-existing" as const,
        importedAt: new Date().toISOString(),
        deactivateMissing: false,
        makes: makes.map((make) => ({
          name: make.name,
          active: make.active,
          sortOrder: make.sortOrder,
          models: make.models.map((model) => ({
            name: model.name,
            active: model.active,
            sortOrder: model.sortOrder,
            aliases: model.aliases.map((alias) => ({
              name: alias.name,
              active: alias.active,
              sortOrder: alias.sortOrder,
            })),
          })),
        })),
      },
    };
  } catch (error) {
    await reportUnexpectedCatalogueFailure(
      error,
      "exportVehicleCatalogue",
      admin.id,
    );
    return { error: errorMessage(error) };
  }
}
