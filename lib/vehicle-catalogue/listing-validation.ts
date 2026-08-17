import { db } from "@/lib/db";
import type {
  ListingAttributeDefinitionLike,
  ListingAttributeInputLike,
} from "@/lib/listings/attribute-ui";
import type { z } from "zod";
import type { vehicleCatalogueSelectionSchema } from "@/lib/validations/listing";
import { normalizeCatalogueName } from "./normalize";

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

  const canonicalMakeKey = normalizeCatalogueName(selection.canonicalMake ?? "");
  if (
    selection.makeMode === "catalogue" &&
    (!canonicalMakeKey ||
      normalizeCatalogueName(submittedMake) !== canonicalMakeKey)
  ) {
    errors[`attr-${makeDefinition.id}`] = [
      "The selected make no longer matches the active catalogue.",
    ];
    return errors;
  }

  if (selection.modelMode === "catalogue") {
    const canonicalModelKey = normalizeCatalogueName(selection.canonicalModel ?? "");
    const submittedModelKey = normalizeCatalogueName(submittedModel);
    const expectedModelKey = normalizeCatalogueName(
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

    const model = await db.vehicleModel.findFirst({
      where: {
        active: true,
        normalizedName: canonicalModelKey,
        make: { active: true, normalizedName: canonicalMakeKey },
      },
      select: { id: true },
    });
    if (!model) {
      errors[`attr-${modelDefinition.id}`] = [
        "This make and model pair is no longer active. Choose another or use manual entry.",
      ];
    }
    return errors;
  }

  if (selection.makeMode === "catalogue") {
    const make = await db.vehicleMake.findUnique({
      where: { normalizedName: canonicalMakeKey, active: true },
      select: { id: true },
    });
    if (!make) {
      errors[`attr-${makeDefinition.id}`] = [
        "This make is no longer active. Choose another or use manual entry.",
      ];
    }
  }

  return errors;
}
