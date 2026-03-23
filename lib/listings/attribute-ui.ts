import { getMakesWithDb } from "@/lib/constants/vehicle-makes";

export interface ListingAttributeDefinitionLike {
  id: string;
  slug: string;
  name: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

export interface ListingAttributeInputLike {
  attributeDefinitionId: string;
  value: string;
}

export interface ListingAttributeFieldConfig {
  control: "text" | "number" | "select" | "checkbox";
  options?: string[];
  helperText?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  min?: number;
  max?: number;
  step?: number;
}

const VEHICLE_CATEGORY_SLUGS = new Set(["car", "van", "motorbike"]);
const EV_COMPATIBLE_FUELS = new Set(["Electric", "Plug-in Hybrid"]);
const EV_ONLY_ATTRIBUTE_SLUGS = new Set(["battery-range", "charging-time"]);
const ELECTRIC_ONLY_HIDDEN_ATTRIBUTE_SLUGS = new Set([
  "engine-size",
  "fuel-consumption",
  "co2-emissions",
]);
const ALWAYS_HIDDEN_ATTRIBUTE_SLUGS = new Set(["location"]);
const STATIC_VEHICLE_MAKES = getMakesWithDb([]);

export function isVehicleCategorySlug(categorySlug: string | undefined): boolean {
  return Boolean(categorySlug && VEHICLE_CATEGORY_SLUGS.has(categorySlug));
}

export function parseAttributeOptions(options: string | null): string[] {
  if (!options) return [];

  try {
    const parsed = JSON.parse(options);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function isAttributeVisible(
  categorySlug: string | undefined,
  attributeSlug: string,
  fuelType: string | undefined
): boolean {
  if (ALWAYS_HIDDEN_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return false;
  }
  if (!isVehicleCategorySlug(categorySlug)) {
    return true;
  }

  if (EV_ONLY_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return Boolean(fuelType && EV_COMPATIBLE_FUELS.has(fuelType));
  }

  if (fuelType === "Electric" && ELECTRIC_ONLY_HIDDEN_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return false;
  }

  return true;
}

export function getAttributeFieldConfig(
  categorySlug: string | undefined,
  attribute: ListingAttributeDefinitionLike,
  fuelType: string | undefined
): ListingAttributeFieldConfig | null {
  if (!isAttributeVisible(categorySlug, attribute.slug, fuelType)) {
    return null;
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "make") {
    return {
      control: "select",
      options: STATIC_VEHICLE_MAKES,
      helperText: "Choose the vehicle manufacturer.",
    };
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "model") {
    return {
      control: "text",
      placeholder: "e.g. 320d M Sport",
      helperText: "Enter the model exactly as you want it shown in search.",
    };
  }

  if (attribute.dataType === "select") {
    const options = parseAttributeOptions(attribute.options);
    if (options.length === 0) {
      return {
        control: "text",
        placeholder: `Enter ${attribute.name.toLowerCase()}`,
        helperText: "This field is temporarily using free text while options are unavailable.",
      };
    }

    return { control: "select", options };
  }

  if (attribute.dataType === "boolean") {
    return { control: "checkbox" };
  }

  if (attribute.dataType === "number") {
    return getNumberFieldConfig(attribute.slug, attribute.name);
  }

  return {
    control: "text",
    placeholder: `Enter ${attribute.name.toLowerCase()}`,
  };
}

function getNumberFieldConfig(
  slug: string,
  label: string
): ListingAttributeFieldConfig {
  const currentYear = new Date().getFullYear();
  const configs: Record<string, ListingAttributeFieldConfig> = {
    year: {
      control: "number",
      inputMode: "numeric",
      min: 1900,
      max: currentYear + 1,
      step: 1,
      placeholder: `e.g. ${currentYear}`,
    },
    mileage: {
      control: "number",
      inputMode: "numeric",
      min: 0,
      max: 2_000_000,
      step: 1,
      placeholder: "e.g. 45000",
    },
    doors: {
      control: "number",
      inputMode: "numeric",
      min: 1,
      max: 6,
      step: 1,
    },
    seats: {
      control: "number",
      inputMode: "numeric",
      min: 1,
      max: 12,
      step: 1,
    },
    "engine-size": {
      control: "number",
      inputMode: "decimal",
      min: 0.1,
      max: 10,
      step: 0.1,
      placeholder: "e.g. 2.0",
    },
    "engine-power": {
      control: "number",
      inputMode: "numeric",
      min: 1,
      max: 3000,
      step: 1,
      placeholder: "e.g. 300",
    },
    "battery-range": {
      control: "number",
      inputMode: "numeric",
      min: 1,
      max: 2000,
      step: 1,
      placeholder: "e.g. 280",
    },
    "charging-time": {
      control: "number",
      inputMode: "decimal",
      min: 0.1,
      max: 168,
      step: 0.1,
      placeholder: "e.g. 7.5",
    },
    acceleration: {
      control: "number",
      inputMode: "decimal",
      min: 0.1,
      max: 60,
      step: 0.1,
      placeholder: "0-60 mph in seconds",
    },
    "fuel-consumption": {
      control: "number",
      inputMode: "decimal",
      min: 1,
      max: 200,
      step: 0.1,
      placeholder: "e.g. 48.5",
    },
    "co2-emissions": {
      control: "number",
      inputMode: "numeric",
      min: 0,
      max: 1000,
      step: 1,
      placeholder: "g/km",
    },
    "tax-per-year": {
      control: "number",
      inputMode: "numeric",
      min: 0,
      max: 10000,
      step: 1,
      placeholder: "e.g. 190",
    },
    "insurance-group": {
      control: "number",
      inputMode: "numeric",
      min: 1,
      max: 50,
      step: 1,
    },
    "boot-space": {
      control: "number",
      inputMode: "numeric",
      min: 0,
      max: 10000,
      step: 1,
      placeholder: "litres",
    },
  };

  return configs[slug] ?? {
    control: "number",
    inputMode: "numeric",
    step: 1,
    placeholder: `Enter ${label.toLowerCase()}`,
  };
}

export function validateListingAttributes(params: {
  categorySlug: string | undefined;
  definitions: ListingAttributeDefinitionLike[];
  attributes: ListingAttributeInputLike[];
}): {
  fieldErrors: Record<string, string[]>;
  sanitizedAttributes: ListingAttributeInputLike[];
} {
  const submittedValues = new Map(
    params.attributes.map((attribute) => [
      attribute.attributeDefinitionId,
      attribute.value.trim(),
    ])
  );
  const fuelTypeDefinition = params.definitions.find((attribute) => attribute.slug === "fuel-type");
  const fuelType = fuelTypeDefinition
    ? submittedValues.get(fuelTypeDefinition.id)
    : undefined;

  const fieldErrors: Record<string, string[]> = {};
  const sanitizedAttributes: ListingAttributeInputLike[] = [];

  for (const definition of params.definitions) {
    const config = getAttributeFieldConfig(params.categorySlug, definition, fuelType);
    const fieldName = `attr-${definition.id}`;
    const rawValue = submittedValues.get(definition.id) ?? "";

    if (!config) {
      continue;
    }

    if (!rawValue) {
      if (definition.required) {
        fieldErrors[fieldName] = [`${definition.name} is required.`];
      }
      continue;
    }

    const validationError = validateAttributeValue(definition, rawValue, config.options);
    if (validationError) {
      fieldErrors[fieldName] = [validationError];
      continue;
    }

    sanitizedAttributes.push({
      attributeDefinitionId: definition.id,
      value: rawValue,
    });
  }

  return { fieldErrors, sanitizedAttributes };
}

function validateAttributeValue(
  definition: ListingAttributeDefinitionLike,
  value: string,
  options: string[] | undefined
): string | null {
  if (definition.slug === "make" && !STATIC_VEHICLE_MAKES.includes(value)) {
    return "Please choose a make from the list.";
  }

  if (definition.slug === "model") {
    if (value.length < 1) return "Model is required.";
    if (value.length > 80) return "Model must be 80 characters or fewer.";
  }

  if (options && options.length > 0 && !options.includes(value)) {
    return `Please choose a valid ${definition.name.toLowerCase()}.`;
  }

  if (definition.dataType === "boolean" && !["true", "false"].includes(value)) {
    return `${definition.name} must be true or false.`;
  }

  if (definition.dataType !== "number") {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return `${definition.name} must be a valid number.`;
  }

  const config = getNumberFieldConfig(definition.slug, definition.name);
  if (typeof config.min === "number" && numericValue < config.min) {
    return `${definition.name} must be at least ${config.min}.`;
  }
  if (typeof config.max === "number" && numericValue > config.max) {
    return `${definition.name} must be ${config.max} or less.`;
  }
  if (config.step === 1 && !Number.isInteger(numericValue)) {
    return `${definition.name} must be a whole number.`;
  }

  return null;
}
