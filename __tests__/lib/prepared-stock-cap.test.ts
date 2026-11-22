import { describe, expect, it } from "vitest";
import { preparedStockCap } from "@/lib/dealer-stock-sync/prepared-stock-cap";

describe("owner-approved dealer stock capacity", () => {
  it.each(["van-mossel-jacksons", "van-mossel-motor-mall"])("allows 150 listings for %s in either environment", (registryKey) => {
    for (const dealerId of ["staging-account", "production-account"]) {
      expect(preparedStockCap({tier:"PRO", registryKey, dealerId})).toBe(150);
      expect(preparedStockCap({tier:"STARTER", registryKey, dealerId})).toBe(30);
    }
  });
  it("preserves the standard cap for every other source", () => {
    expect(preparedStockCap({tier:"PRO",registryKey:"bvs-vehicles",dealerId:"other"})).toBe(100);
    expect(preparedStockCap({tier:"PRO",registryKey:"van-mossel-jacksons-other",dealerId:"other"})).toBe(100);
  });
});
