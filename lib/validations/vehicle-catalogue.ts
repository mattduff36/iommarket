import { z } from "zod";
import { normalizeCatalogueName } from "@/lib/vehicle-catalogue/normalize";

const nameSchema = z.string().trim().min(1).max(80);
export const VEHICLE_CATALOGUE_IMPORT_LIMITS = {
  jsonBytes: 1_500_000,
  makes: 100,
  modelsPerMake: 150,
  aliasesPerModel: 20,
  totalModels: 7_500,
  totalAliases: 5_000,
} as const;

const metadataSchema = z.object({
  source: z.string().trim().min(1).max(120),
  sourceVersion: z.string().trim().min(1).max(120),
});

export const vehicleMakeMutationSchema = metadataSchema.extend({
  id: z.string().cuid().optional(),
  name: nameSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(-100_000).max(100_000),
});

export const vehicleModelMutationSchema = metadataSchema.extend({
  id: z.string().cuid().optional(),
  makeId: z.string().cuid(),
  name: nameSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(-100_000).max(100_000),
});

export const vehicleAliasMutationSchema = metadataSchema.extend({
  id: z.string().cuid().optional(),
  modelId: z.string().cuid(),
  name: nameSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(-100_000).max(100_000),
});

const importAliasSchema = z.object({
  name: nameSchema,
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
});

const importModelSchema = z.object({
  name: nameSchema,
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
  aliases: z
    .array(importAliasSchema)
    .max(VEHICLE_CATALOGUE_IMPORT_LIMITS.aliasesPerModel)
    .default([]),
});

const importMakeSchema = z.object({
  name: nameSchema,
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
  models: z
    .array(importModelSchema)
    .max(VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake)
    .default([]),
});

export const vehicleCatalogueImportSchema = metadataSchema
  .extend({
    sourceMode: z.enum(["strict", "preserve-existing"]).default("strict"),
    importedAt: z.coerce.date(),
    deactivateMissing: z.boolean().default(false),
    makes: z
      .array(importMakeSchema)
      .min(1)
      .max(VEHICLE_CATALOGUE_IMPORT_LIMITS.makes),
  })
  .superRefine((payload, context) => {
    const makeKeys = new Set<string>();
    const modelCount = payload.makes.reduce(
      (count, make) => count + make.models.length,
      0,
    );
    const aliasCount = payload.makes.reduce(
      (count, make) =>
        count +
        make.models.reduce(
          (modelTotal, model) => modelTotal + model.aliases.length,
          0,
        ),
      0,
    );
    if (modelCount > VEHICLE_CATALOGUE_IMPORT_LIMITS.totalModels) {
      context.addIssue({
        code: "custom",
        path: ["makes"],
        message: `Imports are limited to ${VEHICLE_CATALOGUE_IMPORT_LIMITS.totalModels.toLocaleString("en-GB")} models.`,
      });
    }
    if (aliasCount > VEHICLE_CATALOGUE_IMPORT_LIMITS.totalAliases) {
      context.addIssue({
        code: "custom",
        path: ["makes"],
        message: `Imports are limited to ${VEHICLE_CATALOGUE_IMPORT_LIMITS.totalAliases.toLocaleString("en-GB")} aliases.`,
      });
    }
    if (
      payload.sourceMode === "preserve-existing" &&
      payload.deactivateMissing
    ) {
      context.addIssue({
        code: "custom",
        path: ["deactivateMissing"],
        message:
          "Preserve-existing source mode cannot deactivate missing records.",
      });
    }

    payload.makes.forEach((make, makeIndex) => {
      const makeKey = normalizeCatalogueName(make.name);
      if (makeKeys.has(makeKey)) {
        context.addIssue({
          code: "custom",
          path: ["makes", makeIndex, "name"],
          message: "Make names must be unique after normalization.",
        });
      }
      makeKeys.add(makeKey);

      const modelKeys = new Set<string>();
      const modelAndAliasKeys = new Set<string>();
      make.models.forEach((model, modelIndex) => {
        const modelKey = normalizeCatalogueName(model.name);
        if (modelKeys.has(modelKey)) {
          context.addIssue({
            code: "custom",
            path: ["makes", makeIndex, "models", modelIndex, "name"],
            message: "Model names must be unique per make after normalization.",
          });
        }
        modelKeys.add(modelKey);
        if (modelAndAliasKeys.has(modelKey)) {
          context.addIssue({
            code: "custom",
            path: ["makes", makeIndex, "models", modelIndex, "name"],
            message: "Model names and aliases must be unique per make.",
          });
        }
        modelAndAliasKeys.add(modelKey);

        model.aliases.forEach((alias, aliasIndex) => {
          const aliasKey = normalizeCatalogueName(alias.name);
          if (modelAndAliasKeys.has(aliasKey)) {
            context.addIssue({
              code: "custom",
              path: [
                "makes",
                makeIndex,
                "models",
                modelIndex,
                "aliases",
                aliasIndex,
                "name",
              ],
              message: "Model names and aliases must be unique per make.",
            });
          }
          modelAndAliasKeys.add(aliasKey);
        });
      });
    });
  });

export const vehicleCatalogueImportRequestSchema = z.object({
  json: z.string().min(2).max(VEHICLE_CATALOGUE_IMPORT_LIMITS.jsonBytes),
  dryRun: z.boolean(),
  confirmDeactivateMissing: z.boolean().default(false),
});

export type VehicleCatalogueImport = z.infer<typeof vehicleCatalogueImportSchema>;
export type VehicleMakeMutation = z.infer<typeof vehicleMakeMutationSchema>;
export type VehicleModelMutation = z.infer<typeof vehicleModelMutationSchema>;
export type VehicleAliasMutation = z.infer<typeof vehicleAliasMutationSchema>;
