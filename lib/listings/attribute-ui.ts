import {
  FUEL_TYPE_OPTIONS,
  fuelTypeSchema,
  isEvCompatibleFuelType,
} from "@/lib/constants/fuel-types";
import {
  WRITE_OFF_CATEGORY_SLUG,
  WRITE_OFF_CATEGORY_VALUES,
  WRITE_OFF_CONFIG_ERROR,
} from "@/lib/listings/write-off-category";
import {
  EARLIEST_RECORDED_CHECK,
  findVehicleDetailAttribute,
  isManufacturerSizeDesignation,
  isRealIsoDate,
  maximumRecordedCheckDate,
  withRetainedSelectOption,
} from "@/lib/listings/vehicle-detail-catalog";

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
  control: "text" | "number" | "select" | "checkbox" | "model-select" | "date";
  options?: string[];
  helperText?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  minDate?: string;
  maxDate?: string;
}

export interface ListingAttributeFieldContext {
  valuesBySlug?: Record<string, string>;
  retainedValue?: string;
}

const VEHICLE_CATEGORY_SLUGS = new Set(["car", "van", "motorbike", "motorhome"]);
const EV_ONLY_ATTRIBUTE_SLUGS = new Set(["battery-range", "charging-time"]);
const ELECTRIC_ONLY_HIDDEN_ATTRIBUTE_SLUGS = new Set([
  "engine-size",
  "fuel-consumption",
  "co2-emissions",
]);
const ALWAYS_HIDDEN_ATTRIBUTE_SLUGS = new Set([
  "location",
  "previously-written-off",
]);
export function isVehicleCategorySlug(categorySlug: string | undefined): boolean {
  return Boolean(categorySlug && VEHICLE_CATEGORY_SLUGS.has(categorySlug));
}

export type ListingAttributePolicyContext = {
  enforceListingNs?: boolean;
};

export function getWriteOffConfigurationError(
  categorySlug: string | undefined,
  definitions: ListingAttributeDefinitionLike[],
  policy?: ListingAttributePolicyContext,
): string | null {
  if (!policy?.enforceListingNs || !isVehicleCategorySlug(categorySlug)) {
    return null;
  }

  const definition = definitions.find(
    (candidate) => candidate.slug === WRITE_OFF_CATEGORY_SLUG,
  );
  if (!definition) {
    return WRITE_OFF_CONFIG_ERROR;
  }

  const options = parseAttributeOptions(definition.options);
  const hasRequiredOptions = WRITE_OFF_CATEGORY_VALUES.every((value) =>
    options.includes(value),
  );
  if (!hasRequiredOptions) {
    return WRITE_OFF_CONFIG_ERROR;
  }

  return null;
}

export function isListingAttributeRequired(
  categorySlug: string | undefined,
  attribute: Pick<ListingAttributeDefinitionLike, "required" | "slug">,
  policy?: ListingAttributePolicyContext,
): boolean {
  return (
    attribute.required ||
    (isVehicleCategorySlug(categorySlug) && attribute.slug === "mileage") ||
    Boolean(
      policy?.enforceListingNs &&
        isVehicleCategorySlug(categorySlug) &&
        attribute.slug === WRITE_OFF_CATEGORY_SLUG,
    )
  );
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
  fuelType: string | undefined,
  valuesBySlug?: Record<string, string>,
): boolean {
  if (ALWAYS_HIDDEN_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return false;
  }

  const detail = findVehicleDetailAttribute(categorySlug, attributeSlug);
  if (
    detail?.showWhen &&
    (valuesBySlug?.[detail.showWhen.slug] ?? "") !== detail.showWhen.equals
  ) {
    return false;
  }

  if (!isVehicleCategorySlug(categorySlug)) {
    return true;
  }

  if (EV_ONLY_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return isEvCompatibleFuelType(fuelType);
  }

  if (fuelType === "Electric" && ELECTRIC_ONLY_HIDDEN_ATTRIBUTE_SLUGS.has(attributeSlug)) {
    return false;
  }

  return true;
}

export function getAttributeFieldConfig(
  categorySlug: string | undefined,
  attribute: ListingAttributeDefinitionLike,
  fuelType: string | undefined,
  context?: ListingAttributeFieldContext,
): ListingAttributeFieldConfig | null {
  if (!isAttributeVisible(categorySlug, attribute.slug, fuelType, context?.valuesBySlug)) {
    return null;
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "make") {
    return {
      control: "text",
      placeholder: "Search or enter the manufacturer",
      helperText: "Choose a catalogue make or enter it manually.",
    };
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "model") {
    return {
      control: "model-select",
      placeholder: "e.g. 320d M Sport",
      helperText: "Choose a known model or enter it manually if it is missing.",
    };
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "fuel-type") {
    return {
      control: "select",
      options: [...FUEL_TYPE_OPTIONS],
      helperText: "Choose the vehicle's specific fuel type.",
    };
  }

  if (isVehicleCategorySlug(categorySlug) && attribute.slug === "write-off-category") {
    return {
      control: "select",
      options: parseAttributeOptions(attribute.options),
      helperText:
        "Category N and Category S are permitted only with prominent disclosure. Choose None if the vehicle is not a Category N or S write-off.",
    };
  }

  const detail = findVehicleDetailAttribute(categorySlug, attribute.slug);

  if (attribute.slug === "body-type" && attribute.dataType === "select") {
    return selectConfig(
      attribute,
      legacyBodyTypeValue(categorySlug, context?.retainedValue),
      bodyTypeHelper(categorySlug),
    );
  }

  if (detail?.dataType === "select" || (detail && attribute.dataType === "select")) {
    return selectConfig(attribute, undefined, detail?.helperText, detail?.options);
  }

  if (attribute.dataType === "date" || detail?.dataType === "date") {
    return {
      control: "date",
      minDate: EARLIEST_RECORDED_CHECK,
      maxDate: maximumRecordedCheckDate(),
      helperText: detail?.helperText,
    };
  }

  if (attribute.dataType === "select") {
    return selectConfig(attribute);
  }

  if (attribute.dataType === "boolean") {
    return { control: "checkbox" };
  }

  if (attribute.dataType === "number") {
    const numberConfig = getNumberFieldConfig(attribute.slug, attribute.name, categorySlug);
    return detail?.helperText || detail?.placeholder
      ? {
          ...numberConfig,
          helperText: detail.helperText ?? numberConfig.helperText,
          placeholder: detail.placeholder ?? numberConfig.placeholder,
        }
      : numberConfig;
  }

  if (detail?.dataType === "text") {
    return {
      control: "text",
      maxLength: detail.maxLength,
      placeholder: detail.placeholder,
      helperText: detail.helperText,
    };
  }

  return {
    control: "text",
    placeholder: `Enter ${attribute.name.toLowerCase()}`,
  };
}

function legacyBodyTypeValue(
  categorySlug: string | undefined,
  retainedValue: string | undefined,
): string | undefined {
  if (categorySlug !== "motorhome" && categorySlug !== "van") return undefined;
  return retainedValue;
}

function selectConfig(
  attribute: ListingAttributeDefinitionLike,
  retainedValue?: string,
  helperText?: string,
  fallbackOptions?: readonly string[],
): ListingAttributeFieldConfig {
  const parsed = parseAttributeOptions(attribute.options);
  const official = parsed.length > 0 ? parsed : [...(fallbackOptions ?? [])];
  if (official.length === 0) {
    return {
      control: "text",
      placeholder: `Enter ${attribute.name.toLowerCase()}`,
      helperText: "This field is temporarily using free text while options are unavailable.",
    };
  }

  const options = withRetainedSelectOption(official, retainedValue);
  const retainedExtra = options.length > official.length;
  return {
    control: "select",
    options,
    helperText: retainedExtra
      ? [helperText, "A previously saved value is listed so it can be kept."].filter(Boolean).join(" ")
      : helperText,
  };
}

function bodyTypeHelper(categorySlug: string | undefined): string | undefined {
  if (categorySlug === "motorhome") return "Motorhome type.";
  if (categorySlug === "van") return "Van body type.";
  return undefined;
}

function getNumberFieldConfig(
  slug: string,
  label: string,
  categorySlug?: string,
): ListingAttributeFieldConfig {
  const detail = findVehicleDetailAttribute(categorySlug, slug);
  if (detail?.dataType === "number") {
    const decimal = typeof detail.step === "number" && detail.step < 1;
    return {
      control: "number",
      inputMode: decimal ? "decimal" : "numeric",
      min: detail.min,
      max: detail.max,
      step: detail.step,
      placeholder: detail.placeholder ?? `Enter ${label.toLowerCase()}`,
      helperText: detail.helperText,
    };
  }

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
  retainedAttributes?: ListingAttributeInputLike[];
  enforceListingNs?: boolean;
}): {
  fieldErrors: Record<string, string[]>;
  sanitizedAttributes: ListingAttributeInputLike[];
  configurationError?: string;
} {
  const policy = { enforceListingNs: params.enforceListingNs };
  const configurationError = getWriteOffConfigurationError(
    params.categorySlug,
    params.definitions,
    policy,
  );
  if (configurationError) {
    return {
      fieldErrors: {},
      sanitizedAttributes: [],
      configurationError,
    };
  }

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
  const valuesBySlug: Record<string, string> = {};
  for (const definition of params.definitions) {
    valuesBySlug[definition.slug] = submittedValues.get(definition.id) ?? "";
  }
  const retainedValues = new Map(
    (params.retainedAttributes ?? []).map((attribute) => [
      attribute.attributeDefinitionId,
      attribute.value.trim(),
    ]),
  );

  const fieldErrors: Record<string, string[]> = {};
  const sanitizedAttributes: ListingAttributeInputLike[] = [];

  for (const definition of params.definitions) {
    const config = getAttributeFieldConfig(params.categorySlug, definition, fuelType, {
      valuesBySlug,
      retainedValue: retainedValues.get(definition.id),
    });
    const fieldName = `attr-${definition.id}`;
    const rawValue = submittedValues.get(definition.id) ?? "";

    if (!config) {
      const detail = findVehicleDetailAttribute(params.categorySlug, definition.slug);
      if (detail?.showWhen && rawValue) {
        const parent = findVehicleDetailAttribute(params.categorySlug, detail.showWhen.slug);
        fieldErrors[fieldName] = [
          `${definition.name} can only be saved when ${parent?.name ?? detail.showWhen.slug} is Yes.`,
        ];
      }
      continue;
    }

    if (!rawValue) {
      if (isListingAttributeRequired(params.categorySlug, definition, policy)) {
        fieldErrors[fieldName] = [`${definition.name} is required.`];
      }
      continue;
    }

    const validationError = validateAttributeValue(
      params.categorySlug,
      definition,
      rawValue,
      config,
    );
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
  categorySlug: string | undefined,
  definition: ListingAttributeDefinitionLike,
  value: string,
  config: ListingAttributeFieldConfig,
): string | null {
  if (definition.slug === "fuel-type" && !fuelTypeSchema.safeParse(value).success) {
    return "Please choose a specific fuel type.";
  }

  if (definition.slug === "make") {
    if (value.length < 1) return "Make is required.";
    if (value.length > 80) return "Make must be 80 characters or fewer.";
  }

  if (definition.slug === "model") {
    if (value.length < 1) return "Model is required.";
    if (value.length > 80) return "Model must be 80 characters or fewer.";
  }

  if (definition.slug === "manufacturer-size-designation" && !isManufacturerSizeDesignation(value)) {
    return "Enter a short manufacturer size code, such as L2H2. Dimensions are not calculated from it.";
  }

  if (config.control === "date" || definition.dataType === "date") {
    if (!isRealIsoDate(value)) {
      return `${definition.name} must be a real date in YYYY-MM-DD format.`;
    }
    if (value < EARLIEST_RECORDED_CHECK || value > maximumRecordedCheckDate()) {
      return `${definition.name} must be between ${EARLIEST_RECORDED_CHECK} and today.`;
    }
  }

  if (config.options && config.options.length > 0 && !config.options.includes(value)) {
    return `Please choose a valid ${definition.name.toLowerCase()}.`;
  }

  if (definition.dataType === "boolean" && !["true", "false"].includes(value)) {
    return `${definition.name} must be true or false.`;
  }

  if (typeof config.maxLength === "number" && value.length > config.maxLength) {
    return `${definition.name} must be ${config.maxLength} characters or fewer.`;
  }

  if (definition.dataType !== "number" && config.control !== "number") {
    return null;
  }

  const detail = findVehicleDetailAttribute(categorySlug, definition.slug);
  if (detail?.dataType === "number" && !isCanonicalNumber(value, numericScale(config.step))) {
    return `${definition.name} must be a valid number.`;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return `${definition.name} must be a valid number.`;
  }

  if (typeof config.min === "number" && numericValue < config.min) {
    return `${definition.name} must be at least ${config.min}.`;
  }
  if (typeof config.max === "number" && numericValue > config.max) {
    return `${definition.name} must be ${config.max} or less.`;
  }
  if ((config.step === 1 || config.step === undefined) && !Number.isInteger(numericValue)) {
    return `${definition.name} must be a whole number.`;
  }

  return null;
}

function numericScale(step: number | undefined): number {
  if (step === undefined || step >= 1) return 0;
  const text = String(step);
  const index = text.indexOf(".");
  return index === -1 ? 0 : text.length - index - 1;
}

function isCanonicalNumber(value: string, scale: number): boolean {
  if (value.length > 12) return false;
  if (scale <= 0) return /^(?:0|[1-9]\d*)$/.test(value);
  return new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`).test(value);
}
