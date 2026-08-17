import { describe, expect, it } from "vitest";
import {
  buildSearchCanonicalPath,
  buildSearchUrl,
  shouldIndexSearch,
} from "@/lib/search/search-url";

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

  it("serializes long plug-in fuel filters safely", () => {
    const url = buildSearchUrl(
      { fuelType: "Diesel Plug-in Hybrid" },
      {}
    );
    expect(url).toBe("/search?fuelType=Diesel+Plug-in+Hybrid");
  });

  it("supports sort and featured parameters", () => {
    const url = buildSearchUrl(
      { featured: "true", sort: "price_low" },
      {}
    );
    expect(url).toBe("/search?sort=price_low&featured=true");
  });
});

describe("buildSearchCanonicalPath", () => {
  it("whitelists and orders filters while dropping tracking and defaults", () => {
    expect(
      buildSearchCanonicalPath({
        utm_source: "newsletter",
        category: " classic cars ",
        page: "1",
        sort: "featured",
        q: " Ford & Sons ",
        junk: "ignored",
      }),
    ).toBe("/search?q=Ford+%26+Sons&category=classic+cars");
  });

  it("caps canonical values and normalizes pagination", () => {
    expect(
      buildSearchCanonicalPath({
        q: "x".repeat(200),
        page: "0003",
      }),
    ).toBe(`/search?q=${"x".repeat(120)}&page=3`);
  });

  it("keeps accepted non-default sorts and drops bogus or default values", () => {
    expect(buildSearchCanonicalPath({ sort: "newest" })).toBe(
      "/search?sort=newest",
    );
    expect(buildSearchCanonicalPath({ sort: "featured" })).toBe("/search");
    expect(buildSearchCanonicalPath({ sort: "made-up" })).toBe("/search");
  });
});

describe("shouldIndexSearch", () => {
  it("allows only the unfiltered base search page to index", () => {
    expect(shouldIndexSearch({})).toBe(true);
    expect(shouldIndexSearch({ page: "1", utm_source: "ignored" })).toBe(true);
    expect(shouldIndexSearch({ q: "ford" })).toBe(false);
    expect(shouldIndexSearch({ page: "2" })).toBe(false);
    expect(shouldIndexSearch({ category: "car" }, "car")).toBe(true);
    expect(shouldIndexSearch({ category: "car" }, null)).toBe(false);
    expect(
      shouldIndexSearch({ category: "car", region: "douglas" }, "car"),
    ).toBe(false);
  });
});
