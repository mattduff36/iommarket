import { getMakesWithDb } from "@/lib/constants/vehicle-makes";
import {
  parseAttributeOptions,
  type ListingAttributeDefinitionLike,
} from "@/lib/listings/attribute-ui";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

const KNOWN_MAKES = getMakesWithDb([]);

const MAKE_ALIASES: Record<string, string> = {
  ALFAROMEO: "Alfa Romeo",
  LANDROVER: "Land Rover",
  MERCEDES: "Mercedes-Benz",
  MERCEDESBENZ: "Mercedes-Benz",
  ROLLSROYCE: "Rolls-Royce",
  SSANGYONG: "SsangYong",
  VW: "Volkswagen",
};

const FUEL_ALIASES: Record<string, string> = {
  BEV: "Electric",
  DIESEL: "Diesel",
  ELECTRIC: "Electric",
  EV: "Electric",
  GASOLINE: "Petrol",
  HYBRID: "Hybrid",
  MHEV: "Hybrid",
  PETROL: "Petrol",
  PHEV: "Plug-in Hybrid",
  PLUGINHYBRID: "Plug-in Hybrid",
};

const COLOUR_ALIASES: Record<string, string> = {
  BEIGE: "Brown",
  BLACK: "Black",
  BLUE: "Blue",
  BRONZE: "Bronze",
  BROWN: "Brown",
  GOLD: "Gold",
  GRAY: "Grey",
  GREEN: "Green",
  GREY: "Grey",
  ORANGE: "Orange",
  RED: "Red",
  SILVER: "Silver",
  WHITE: "White",
  YELLOW: "Yellow",
};

export interface VehicleAutofillResult {
  values: Record<string, string>;
  appliedAttributeIds: string[];
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function matchOption(value: string, options: string[]): string | null {
  const normalizedValue = normalizeKey(value);
  if (!normalizedValue) return null;

  for (const option of options) {
    if (normalizeKey(option) === normalizedValue) {
      return option;
    }
  }

  return null;
}

function normalizeMake(rawValue: string | null): string | null {
  if (!rawValue) return null;
  const compact = normalizeKey(rawValue);
  if (!compact) return null;

  const alias = MAKE_ALIASES[compact];
  if (alias && KNOWN_MAKES.includes(alias)) {
    return alias;
  }

  for (const make of KNOWN_MAKES) {
    if (normalizeKey(make) === compact) {
      return make;
    }
  }

  return null;
}

function normalizeFuelType(
  rawValue: string | null,
  options: string[]
): string | null {
  if (!rawValue) return null;
  const compact = normalizeKey(rawValue);
  if (!compact) return null;

  const canonical = FUEL_ALIASES[compact] ?? rawValue.trim();
  if (options.length === 0) {
    return canonical;
  }

  return matchOption(canonical, options);
}

function normalizeColour(rawValue: string | null, options: string[]): string | null {
  if (!rawValue) return null;
  const compact = normalizeKey(rawValue);
  if (!compact) return null;

  const canonical = COLOUR_ALIASES[compact] ?? rawValue.trim();
  if (options.length === 0) {
    return canonical;
  }

  return matchOption(canonical, options);
}

function toWholeNumberString(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(Math.round(value));
}

function toEngineLitresString(engineSizeCc: number | null): string | null {
  if (typeof engineSizeCc !== "number" || !Number.isFinite(engineSizeCc) || engineSizeCc <= 0) {
    return null;
  }
  const litres = Math.round((engineSizeCc / 1000) * 10) / 10;
  return litres.toFixed(1);
}

function parseTaxPerYear(roadTax12Month: string | null): string | null {
  if (!roadTax12Month) return null;
  const match = roadTax12Month.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return String(Math.round(Number.parseFloat(match[1])));
}

function normalizeModel(model: string | null): string | null {
  if (!model) return null;
  const trimmed = model.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

export function mapVehicleResultToListingAttributes(params: {
  definitions: ListingAttributeDefinitionLike[];
  result: VehicleCheckResult;
}): VehicleAutofillResult {
  const values: Record<string, string> = {};
  const appliedAttributeIds: string[] = [];
  const vehicle = params.result.vehicle;
  const motHistory = params.result.motHistory;

  if (!vehicle && !motHistory) {
    return { values, appliedAttributeIds };
  }

  for (const definition of params.definitions) {
    const options = parseAttributeOptions(definition.options);
    let nextValue: string | null = null;

    switch (definition.slug) {
      case "make":
        nextValue = normalizeMake(vehicle?.make ?? motHistory?.make ?? null);
        break;
      case "model":
        nextValue = normalizeModel(vehicle?.model ?? motHistory?.model ?? null);
        break;
      case "year":
        nextValue = toWholeNumberString(vehicle?.yearOfManufacture ?? null);
        break;
      case "fuel-type":
        nextValue = normalizeFuelType(
          vehicle?.fuelType ?? motHistory?.fuelType ?? null,
          options
        );
        break;
      case "colour":
        nextValue = normalizeColour(
          vehicle?.colour ?? motHistory?.primaryColour ?? null,
          options
        );
        break;
      case "engine-size":
        nextValue = toEngineLitresString(vehicle?.engineSizeCc ?? null);
        break;
      case "co2-emissions":
        nextValue = toWholeNumberString(vehicle?.co2Emissions ?? null);
        break;
      case "tax-per-year":
        nextValue = parseTaxPerYear(vehicle?.roadTax12Month ?? null);
        break;
      default:
        break;
    }

    if (!nextValue) {
      continue;
    }

    values[definition.id] = nextValue;
    appliedAttributeIds.push(definition.id);
  }

  return { values, appliedAttributeIds };
}
