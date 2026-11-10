import { VEHICLE_MAKES } from "@/lib/constants/vehicle-make-names";
import { cleanCatalogueName, normalizeCatalogueName } from "./normalize";

const CANONICAL_MAKES_BY_KEY = new Map(
  VEHICLE_MAKES.map((make) => [normalizeCatalogueName(make), make]),
);

const MAKE_KEY_ALIASES: Record<string, string> = {
  merc: "mercedesbenz",
  mercedes: "mercedesbenz",
  mercedesamg: "mercedesbenz",
  mercedesbenzamg: "mercedesbenz",
  vw: "volkswagen",
  ds: "dsautomobiles",
  rangerover: "landrover",
};

export function normalizeMakeLookupKey(value: string): string {
  const key = normalizeCatalogueName(value.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
  return Object.hasOwn(MAKE_KEY_ALIASES, key) ? MAKE_KEY_ALIASES[key] : key;
}

/** Includes keys stored by older catalogue imports, not just current display names. */
export function makeCatalogueLookupKeys(value: string): string[] {
  const key = normalizeMakeLookupKey(value);
  return [...new Set([
    key,
    ...Object.entries(MAKE_KEY_ALIASES).filter(([, target]) => target === key).map(([alias]) => alias),
    ...(key === "skoda" ? ["koda"] : []),
  ])];
}

export function canonicalizeKnownMake(value: string): string | null {
  const cleaned = cleanCatalogueName(value);
  if (!cleaned) return null;
  const key = normalizeMakeLookupKey(cleaned);
  return CANONICAL_MAKES_BY_KEY.get(key) ?? cleaned.replace(
    /[A-Za-z]+/g,
    (word) => word[0].toUpperCase() + word.slice(1).toLowerCase(),
  );
}
