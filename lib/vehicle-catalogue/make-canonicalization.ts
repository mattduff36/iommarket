import { VEHICLE_MAKES } from "@/lib/constants/vehicle-makes";
import { cleanCatalogueName, normalizeCatalogueName } from "./normalize";

const CANONICAL_MAKES_BY_KEY = new Map(
  VEHICLE_MAKES.map((make) => [normalizeCatalogueName(make), make]),
);

const MAKE_KEY_ALIASES: Record<string, string> = {
  merc: "mercedesbenz",
  mercedes: "mercedesbenz",
  vw: "volkswagen",
};

export function normalizeMakeLookupKey(value: string): string {
  const key = normalizeCatalogueName(value);
  return MAKE_KEY_ALIASES[key] ?? key;
}

export function canonicalizeKnownMake(value: string): string | null {
  const cleaned = cleanCatalogueName(value);
  if (!cleaned) return null;
  const key = normalizeMakeLookupKey(cleaned);
  return CANONICAL_MAKES_BY_KEY.get(key) ?? cleaned;
}
