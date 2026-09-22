import { afterEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const originalLaunch = process.env.PRODUCTION_LAUNCH_ENABLED;
const originalVercel = process.env.VERCEL_ENV;

describe("robots metadata", () => {
  afterEach(() => {
    if (originalLaunch === undefined) delete process.env.PRODUCTION_LAUNCH_ENABLED;
    else process.env.PRODUCTION_LAUNCH_ENABLED = originalLaunch;
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
  });

  it("uses the shared canonical origin for the sitemap when the catalogue is public", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    expect(robots().sitemap).toBe(buildCanonicalUrl("/sitemap.xml"));
  });

  it("disallows the whole site and omits the sitemap while production is gated", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    expect(robots()).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
