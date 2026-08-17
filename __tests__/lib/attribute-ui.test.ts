import { describe, expect, it } from "vitest";
import {
  getAttributeFieldConfig,
  isListingAttributeRequired,
  parseAttributeOptions,
  validateListingAttributes,
} from "@/lib/listings/attribute-ui";
import { WRITE_OFF_CONFIG_ERROR } from "@/lib/listings/listing-ns-policy";
import { groupWriteOffWithVehicleDetails } from "@/lib/listings/listing-ns-ui";
import { FUEL_TYPE_OPTIONS } from "@/lib/constants/fuel-types";

const makeDef = {
  id: "clmake12345678901234567890",
  name: "Make",
  slug: "make",
  dataType: "text",
  required: true,
  options: null,
};

const modelDef = {
  id: "clmodel1234567890123456789",
  name: "Model",
  slug: "model",
  dataType: "text",
  required: true,
  options: null,
};

const mileageDef = {
  id: "clmileage12345678901234567",
  name: "Mileage",
  slug: "mileage",
  dataType: "number",
  required: false,
  options: null,
};

const fuelTypeDef = {
  id: "clfuel12345678901234567890",
  name: "Fuel Type",
  slug: "fuel-type",
  dataType: "select",
  required: false,
  options: JSON.stringify(FUEL_TYPE_OPTIONS),
};

const batteryRangeDef = {
  id: "clbattery12345678901234567",
  name: "Battery Range",
  slug: "battery-range",
  dataType: "number",
  required: false,
  options: null,
};

const locationDef = {
  id: "cllocation123456789012345",
  name: "Location",
  slug: "location",
  dataType: "select",
  required: false,
  options: JSON.stringify(["Isle of Man", "UK"]),
};

const writeOffDef = {
  id: "clwriteoff12345678901234",
  name: "Insurance write-off category",
  slug: "write-off-category",
  dataType: "select",
  required: false,
  options: JSON.stringify(["None", "Category N", "Category S"]),
};

describe("parseAttributeOptions", () => {
  it("returns an empty array for malformed options", () => {
    expect(parseAttributeOptions("{bad json")).toEqual([]);
  });
});

describe("getAttributeFieldConfig", () => {
  it("leaves make as text for the progressive catalogue control", () => {
    const config = getAttributeFieldConfig("car", makeDef, undefined);
    expect(config?.control).toBe("text");
    expect(config?.helperText).toContain("catalogue");
  });

  it("treats motorhome as a vehicle category", () => {
    const config = getAttributeFieldConfig("motorhome", makeDef, undefined);
    expect(config?.control).toBe("text");
  });

  it("hides EV-only fields for petrol vehicles and duplicate location always", () => {
    expect(getAttributeFieldConfig("car", batteryRangeDef, "Petrol")).toBeNull();
    expect(getAttributeFieldConfig("car", locationDef, "Electric")).toBeNull();
  });

  it("uses the standardized fuel types even before the database migration runs", () => {
    const config = getAttributeFieldConfig("car", fuelTypeDef, undefined);
    expect(config?.options).toEqual(FUEL_TYPE_OPTIONS);
  });
});

describe("validateListingAttributes", () => {
  const definitions = [
    makeDef,
    modelDef,
    mileageDef,
    fuelTypeDef,
    batteryRangeDef,
    locationDef,
  ];

  it("requires missing required vehicle attributes", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [],
    });

    expect(result.fieldErrors[`attr-${makeDef.id}`]).toEqual(["Make is required."]);
    expect(result.fieldErrors[`attr-${modelDef.id}`]).toEqual(["Model is required."]);
    expect(result.fieldErrors[`attr-${mileageDef.id}`]).toEqual(["Mileage is required."]);
  });

  it("does not require mileage for non-vehicle categories", () => {
    const result = validateListingAttributes({
      categorySlug: "furniture",
      definitions: [mileageDef],
      attributes: [],
    });

    expect(result.fieldErrors).toEqual({});
  });

  it("accepts bounded manual makes outside the catalogue", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "Made Up Motors" },
        { attributeDefinitionId: modelDef.id, value: "Roadster" },
      ],
    });

    expect(result.fieldErrors[`attr-${makeDef.id}`]).toBeUndefined();
  });

  it("LST-ATTR-SCOPE-001 sanitizes only server-known attribute definitions", () => {
    const deterministicWriteOff = {
      ...writeOffDef,
      id: "attr_writeoff_cmn3oefbu0001twzjvgysi1k5",
    };
    const result = validateListingAttributes({
      categorySlug: "van",
      definitions: [deterministicWriteOff],
      attributes: [
        {
          attributeDefinitionId: deterministicWriteOff.id,
          value: "None",
        },
        {
          attributeDefinitionId: "unknown_but_bounded",
          value: "Category N",
        },
      ],
    });

    expect(result.fieldErrors).toEqual({});
    expect(result.sanitizedAttributes).toEqual([
      {
        attributeDefinitionId: deterministicWriteOff.id,
        value: "None",
      },
    ]);
  });

  it.each(["Hybrid", "Plug-in Hybrid"])(
    "rejects removed generic fuel type %s",
    (fuelType) => {
      const result = validateListingAttributes({
        categorySlug: "car",
        definitions,
        attributes: [
          { attributeDefinitionId: makeDef.id, value: "BMW" },
          { attributeDefinitionId: modelDef.id, value: "320d" },
          { attributeDefinitionId: mileageDef.id, value: "45000" },
          { attributeDefinitionId: fuelTypeDef.id, value: fuelType },
        ],
      });

      expect(result.fieldErrors[`attr-${fuelTypeDef.id}`]).toEqual([
        "Please choose a specific fuel type.",
      ]);
    }
  );

  it.each(FUEL_TYPE_OPTIONS)("accepts standardized fuel type %s", (fuelType) => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
        { attributeDefinitionId: fuelTypeDef.id, value: fuelType },
      ],
    });

    expect(result.fieldErrors[`attr-${fuelTypeDef.id}`]).toBeUndefined();
  });

  it("drops hidden location and EV-only values when fuel type does not support them", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
        { attributeDefinitionId: fuelTypeDef.id, value: "Petrol" },
        { attributeDefinitionId: batteryRangeDef.id, value: "300" },
        { attributeDefinitionId: locationDef.id, value: "UK" },
      ],
    });

    expect(result.fieldErrors).toEqual({});
    expect(result.sanitizedAttributes).toEqual([
      { attributeDefinitionId: makeDef.id, value: "BMW" },
      { attributeDefinitionId: modelDef.id, value: "320d" },
      { attributeDefinitionId: mileageDef.id, value: "45000" },
      { attributeDefinitionId: fuelTypeDef.id, value: "Petrol" },
    ]);
  });

  it("requires make and model for motorhomes", () => {
    const result = validateListingAttributes({
      categorySlug: "motorhome",
      definitions,
      attributes: [],
    });

    expect(result.fieldErrors[`attr-${makeDef.id}`]).toEqual(["Make is required."]);
    expect(result.fieldErrors[`attr-${modelDef.id}`]).toEqual(["Model is required."]);
  });

  it("LST-VAL-001 does not require seed-optional write-off when enforcement is off", () => {
    expect(
      isListingAttributeRequired("car", writeOffDef, { enforceListingNs: false }),
    ).toBe(false);

    const result = validateListingAttributes({
      categorySlug: "car",
      definitions: [...definitions, writeOffDef],
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
      ],
      enforceListingNs: false,
    });

    expect(result.fieldErrors[`attr-${writeOffDef.id}`]).toBeUndefined();
    expect(result.configurationError).toBeUndefined();
  });

  it("LST-VAL-001 LST-WRITEOFF-001 requires write-off as attr-<id> when enforcement is on", () => {
    expect(
      isListingAttributeRequired("car", writeOffDef, { enforceListingNs: true }),
    ).toBe(true);

    const result = validateListingAttributes({
      categorySlug: "car",
      definitions: [...definitions, writeOffDef],
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
      ],
      enforceListingNs: true,
    });

    expect(result.fieldErrors[`attr-${writeOffDef.id}`]).toEqual([
      "Insurance write-off category is required.",
    ]);
  });

  it("LST-WRITEOFF-001 yields attr-<id> for an invalid write-off when enforcement is on", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions: [...definitions, writeOffDef],
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
        { attributeDefinitionId: writeOffDef.id, value: "Category A" },
      ],
      enforceListingNs: true,
    });

    expect(result.fieldErrors[`attr-${writeOffDef.id}`]).toEqual([
      "Please choose a valid insurance write-off category.",
    ]);
  });

  it("LST-WRITEOFF-001 fails closed when a vehicle category lacks the write-off definition", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
      ],
      enforceListingNs: true,
    });

    expect(result.configurationError).toBe(WRITE_OFF_CONFIG_ERROR);
    expect(result.fieldErrors).toEqual({});
    expect(result.sanitizedAttributes).toEqual([]);
  });

  it("LST-WRITEOFF-001 fails closed when write-off options are missing", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions: [...definitions, { ...writeOffDef, options: null }],
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: mileageDef.id, value: "45000" },
      ],
      enforceListingNs: true,
    });

    expect(result.configurationError).toBe(WRITE_OFF_CONFIG_ERROR);
  });

  it("LST-WRITEOFF-001 groups write-off after mileage and fuel", () => {
    const ordered = groupWriteOffWithVehicleDetails([
      { slug: "make" },
      { slug: "write-off-category" },
      { slug: "fuel-type" },
      { slug: "colour" },
      { slug: "mileage" },
      { slug: "engine-size" },
    ]);

    expect(ordered.map((item) => item.slug)).toEqual([
      "make",
      "fuel-type",
      "colour",
      "mileage",
      "write-off-category",
      "engine-size",
    ]);
  });
});
