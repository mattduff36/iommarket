import { VEHICLE_MAKES } from "./vehicle-make-names";
import { canonicalizeKnownMake, normalizeMakeLookupKey } from "@/lib/vehicle-catalogue/make-canonicalization";

export { VEHICLE_MAKES };

/** Include custom makes without repeating known makes under legacy aliases. */
export function getMakesWithDb(dbMakes: string[]): string[] {
  const makes = new Map<string, string>();
  for (const value of [...VEHICLE_MAKES, ...dbMakes]) {
    const name = canonicalizeKnownMake(value);
    if (name) makes.set(normalizeMakeLookupKey(name), name);
  }
  return [...makes.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
