import { describe, expect, it } from "vitest";
import {
  buildCategorySearchPath,
  buildDealerProfilePath,
  buildListingPath,
  encodePathSegment,
} from "@/lib/navigation-paths";

describe("navigation path builders", () => {
  it("encodes dynamic path segments and query values", () => {
    expect(buildDealerProfilePath("dealer/name")).toBe(
      "/dealers/dealer%2Fname",
    );
    expect(buildListingPath("listing?#1")).toBe(
      "/listings/listing%3F%231",
    );
    expect(buildCategorySearchPath("classic cars & vans")).toBe(
      "/search?category=classic+cars+%26+vans",
    );
  });

  it("rejects empty path segments", () => {
    expect(() => encodePathSegment("   ")).toThrow("must not be empty");
  });
});
