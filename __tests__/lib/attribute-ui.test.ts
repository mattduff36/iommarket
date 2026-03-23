import { describe, expect, it } from "vitest";
import {
  getAttributeFieldConfig,
  parseAttributeOptions,
  validateListingAttributes,
} from "@/lib/listings/attribute-ui";

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

const fuelTypeDef = {
  id: "clfuel12345678901234567890",
  name: "Fuel Type",
  slug: "fuel-type",
  dataType: "select",
  required: false,
  options: JSON.stringify(["Petrol", "Diesel", "Electric", "Plug-in Hybrid"]),
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

describe("parseAttributeOptions", () => {
  it("returns an empty array for malformed options", () => {
    expect(parseAttributeOptions("{bad json")).toEqual([]);
  });
});

describe("getAttributeFieldConfig", () => {
  it("renders make as a dropdown for vehicle categories", () => {
    const config = getAttributeFieldConfig("car", makeDef, undefined);
    expect(config?.control).toBe("select");
    expect(config?.options?.includes("BMW")).toBe(true);
  });

  it("hides EV-only fields for petrol vehicles and duplicate location always", () => {
    expect(getAttributeFieldConfig("car", batteryRangeDef, "Petrol")).toBeNull();
    expect(getAttributeFieldConfig("car", locationDef, "Electric")).toBeNull();
  });
});

describe("validateListingAttributes", () => {
  const definitions = [makeDef, modelDef, fuelTypeDef, batteryRangeDef, locationDef];

  it("requires missing required vehicle attributes", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [],
    });

    expect(result.fieldErrors[`attr-${makeDef.id}`]).toEqual(["Make is required."]);
    expect(result.fieldErrors[`attr-${modelDef.id}`]).toEqual(["Model is required."]);
  });

  it("rejects makes outside the curated list", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "Made Up Motors" },
        { attributeDefinitionId: modelDef.id, value: "Roadster" },
      ],
    });

    expect(result.fieldErrors[`attr-${makeDef.id}`]).toEqual([
      "Please choose a make from the list.",
    ]);
  });

  it("drops hidden location and EV-only values when fuel type does not support them", () => {
    const result = validateListingAttributes({
      categorySlug: "car",
      definitions,
      attributes: [
        { attributeDefinitionId: makeDef.id, value: "BMW" },
        { attributeDefinitionId: modelDef.id, value: "320d" },
        { attributeDefinitionId: fuelTypeDef.id, value: "Petrol" },
        { attributeDefinitionId: batteryRangeDef.id, value: "300" },
        { attributeDefinitionId: locationDef.id, value: "UK" },
      ],
    });

    expect(result.fieldErrors).toEqual({});
    expect(result.sanitizedAttributes).toEqual([
      { attributeDefinitionId: makeDef.id, value: "BMW" },
      { attributeDefinitionId: modelDef.id, value: "320d" },
      { attributeDefinitionId: fuelTypeDef.id, value: "Petrol" },
    ]);
  });
});
