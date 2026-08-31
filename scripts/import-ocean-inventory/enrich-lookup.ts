import { isVehicleLookupError } from "../../lib/services/vehicle-check-error";
import type { VehicleCheckResult } from "../../lib/services/vehicle-check-types";
import { ENRICH_DEFAULT_LOOKUP_DELAY_MS } from "./enrich-types";

export async function lookupWithPacing<T>(input: {
  items: T[];
  lookup: (item: T) => Promise<VehicleCheckResult>;
  delayMs?: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<
  Array<
    | { item: T; ok: true; result: VehicleCheckResult }
    | { item: T; ok: false; error: string }
  >
> {
  const delayMs = input.delayMs ?? ENRICH_DEFAULT_LOOKUP_DELAY_MS;
  const outcomes: Array<
    | { item: T; ok: true; result: VehicleCheckResult }
    | { item: T; ok: false; error: string }
  > = [];

  for (const [index, item] of input.items.entries()) {
    try {
      const result = await input.lookup(item);
      outcomes.push({ item, ok: true, result });
    } catch (error) {
      const message = isVehicleLookupError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Vehicle lookup failed";
      outcomes.push({ item, ok: false, error: message });
    }
    if (index < input.items.length - 1 && delayMs > 0) {
      await input.sleep(delayMs);
    }
  }

  return outcomes;
}
