import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

describe("robots metadata", () => {
  it("uses the shared canonical origin for the sitemap", () => {
    expect(robots().sitemap).toBe(buildCanonicalUrl("/sitemap.xml"));
  });
});
