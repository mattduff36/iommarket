import { db } from "@/lib/db";
import type {
  ListingAttributeDefinitionLike,
  ListingAttributeInputLike,
} from "@/lib/listings/attribute-ui";
import type { z } from "zod";
import type { vehicleCatalogueSelectionSchema } from "@/lib/validations/listing";
import { makeCatalogueLookupKeys, normalizeMakeLookupKey } from "./make-canonicalization";
import { normalizeCatalogueName } from "./normalize";
import { normalizeVehicleMakeModel, normalizeVehicleModelLookupKey } from "./vehicle-normalization";

type VehicleCatalogueSelection = z.infer<typeof vehicleCatalogueSelectionSchema>;

export async function validateVehicleCatalogueSubmission(params: {
  definitions: ListingAttributeDefinitionLike[];
  attributes: ListingAttributeInputLike[];
  selection?: VehicleCatalogueSelection;
}): Promise<Record<string, string[]>> {
  const { selection } = params;
  if (!selection) return {};

  const makeDefinition = params.definitions.find((item) => item.slug === "make");
  const modelDefinition = params.definitions.find((item) => item.slug === "model");
  if (!makeDefinition || !modelDefinition) return {};

  const values = new Map(
    params.attributes.map((item) => [item.attributeDefinitionId, item.value]),
  );
  const submittedMake = values.get(makeDefinition.id) ?? "";
  const submittedModel = values.get(modelDefinition.id) ?? "";
  const errors: Record<string, string[]> = {};

  if (selection.makeMode === "manual" && selection.modelMode === "manual") {
    return errors;
  }
  if (selection.modelMode === "catalogue" && selection.makeMode !== "catalogue") {
    errors[`attr-${modelDefinition.id}`] = [
      "Choose a catalogue make before choosing a catalogue model.",
    ];
    return errors;
  }

  const canonicalMakeKey = normalizeMakeLookupKey(selection.canonicalMake ?? "");
  const makeKeys = makeCatalogueLookupKeys(canonicalMakeKey);
  if (
    selection.makeMode === "catalogue" &&
    (!canonicalMakeKey ||
      normalizeMakeLookupKey(submittedMake) !== canonicalMakeKey)
  ) {
    errors[`attr-${makeDefinition.id}`] = [
      "The selected make no longer matches the active catalogue.",
    ];
    return errors;
  }

  if (selection.modelMode === "catalogue") {
    const canonicalModelKey = normalizeCatalogueName(selection.canonicalModel ?? "");
    const submittedModelKey = normalizeVehicleModelLookupKey(submittedMake, submittedModel);
    const expectedModelKey = normalizeVehicleModelLookupKey(
      selection.canonicalMake,
      [selection.canonicalModel, selection.variant]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" "),
    );
    if (!canonicalModelKey || submittedModelKey !== expectedModelKey) {
      errors[`attr-${modelDefinition.id}`] = [
        "The selected model no longer matches the active catalogue.",
      ];
      return errors;
    }

    const canonicalModel = normalizeVehicleMakeModel(selection.canonicalMake, selection.canonicalModel).model ?? "";
    const modelKeys = [...new Set([
      canonicalModelKey,
      normalizeCatalogueName(canonicalModel),
      ...(canonicalMakeKey === "landrover"
        ? [
            normalizeCatalogueName(canonicalModel.replace(/^Range Rover\s+/i, "")),
            ...(/^Discovery\b/i.test(canonicalModel)
              ? [normalizeCatalogueName(`Range Rover ${canonicalModel}`)]
              : []),
          ]
        : []),
      ...(canonicalMakeKey === "mercedesbenz"
        ? [normalizeCatalogueName(canonicalModel.replace(/\s+AMG$/i, ""))]
        : []),
    ])];
    const models = await db.vehicleModel.findMany({
      where: {
        active: true,
        normalizedName: { in: modelKeys },
        make: { active: true, normalizedName: { in: makeKeys } },
      },
      take: 20,
      select: { name: true, make: { select: { name: true } } },
    });
    if (!models.some((model) =>
      normalizeVehicleModelLookupKey(model.make.name, model.name) ===
      normalizeVehicleModelLookupKey(selection.canonicalMake, selection.canonicalModel)
    )) {
      errors[`attr-${modelDefinition.id}`] = [
        "This make and model pair is no longer active. Choose another or use manual entry.",
      ];
    }
    return errors;
  }

  if (selection.makeMode === "catalogue") {
    const makes = await db.vehicleMake.findMany({
      where: { normalizedName: { in: makeKeys }, active: true },
      take: makeKeys.length,
      select: { id: true },
    });
    if (makes.length === 0) {
      errors[`attr-${makeDefinition.id}`] = [
        "This make is no longer active. Choose another or use manual entry.",
      ];
    }
  }

  return errors;
}
