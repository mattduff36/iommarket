import { describe, expect, it } from "vitest";
import { buildSearchUrl } from "@/lib/search/search-url";

describe("buildSearchUrl", () => {
  it("builds query string with active params", () => {
    const url = buildSearchUrl(
      { make: "BMW", minPrice: "1000", page: "2" },
      {}
    );
    expect(url).toBe("/search?make=BMW&minPrice=1000&page=2");
  });

  it("resets page when filters change", () => {
    const url = buildSearchUrl(
      { make: "BMW", page: "3" },
      { model: "320d" }
    );
    expect(url).toBe("/search?make=BMW&model=320d");
  });

  it("supports location parameter for crawlable filters", () => {
    const url = buildSearchUrl(
      { location: "Isle of Man" },
      {}
    );
    expect(url).toBe("/search?location=Isle+of+Man");
  });
});
