import { describe, expect, it } from "vitest";
import { publicDetailLink } from "@/lib/dealer-stock-sync/public-detail-link";

describe("dealer listing source links", () => {
  const detail = "https://bvsvehicles.com/vehicle/123";
  it("keeps a detail URL belonging to the bound dealer", () => {
    expect(publicDetailLink("bvs-vehicles", detail)).toBe(detail);
  });
  it.each([
    [undefined, detail],
    ["unknown-dealer", detail],
    ["bvs-vehicles", "https://bvsvehicles.com/our-vehicles/"],
    ["bvs-vehicles", "https://bvsvehicles.com.other.example/vehicle/123"],
    ["bvs-vehicles", "https://bvsvehicles.com@other.example/vehicle/123"],
  ])("hides an unverified destination", (key, url) => {
    expect(publicDetailLink(key, url)).toBeNull();
  });
});
