import { afterEach, describe, expect, it, vi } from "vitest";
import { setNodeEnv } from "@/__tests__/lib/seo-test-env";
import robots from "@/app/robots";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const originalLaunch = process.env.PRODUCTION_LAUNCH_ENABLED;
const originalVercel = process.env.VERCEL_ENV;
const originalNode = process.env.NODE_ENV;

describe("robots metadata", () => {
  afterEach(() => {
    if (originalLaunch === undefined) delete process.env.PRODUCTION_LAUNCH_ENABLED;
    else process.env.PRODUCTION_LAUNCH_ENABLED = originalLaunch;
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
    setNodeEnv(originalNode);
    vi.useRealTimers();
  });

  it("keeps an open preview crawlable and does not advertise a sitemap", () => {
    process.env.VERCEL_ENV = "preview";
    setNodeEnv("production");
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api"] },
    });
  });

  it("advertises the production sitemap only when indexing is enabled", () => {
    process.env.VERCEL_ENV = "production";
    setNodeEnv("production");
    process.env.PRODUCTION_LAUNCH_ENABLED = "1";
    process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
    expect(robots().sitemap).toBe(buildCanonicalUrl("/sitemap.xml"));
  });

  it("disallows the whole site and omits the sitemap while production is gated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    process.env.VERCEL_ENV = "production";
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    expect(robots()).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
