import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/preview-packs/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order with a concurrency cap", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(value);
      await Promise.resolve();
      inFlight -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(seen).toHaveLength(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("returns an empty array for no items", async () => {
    expect(await mapWithConcurrency([], 4, async (value) => value)).toEqual([]);
  });
});
