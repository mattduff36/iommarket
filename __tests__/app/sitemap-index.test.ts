import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateSitemaps } = vi.hoisted(() => ({ generateSitemaps: vi.fn() }));
vi.mock("@/app/catalogue/sitemap", () => ({ generateSitemaps }));
import { GET } from "@/app/sitemap.xml/route";
import { classifyLaunchRoute } from "@/lib/launch/route-class";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.im");
  generateSitemaps.mockReset().mockResolvedValue([{ id: "0" }, { id: "1" }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("sitemap index route", () => {
  it("classifies exact partition URLs as SEO routes without exposing neighbouring paths", () => {
    expect(classifyLaunchRoute("/catalogue/sitemap/0.xml")).toBe("seo");
    expect(classifyLaunchRoute("/catalogue/sitemap/12.xml")).toBe("seo");
    for (const path of ["/catalogue", "/catalogue/sitemap/0.xml/admin", "/catalogue/sitemap/abc.xml"]) {
      expect(classifyLaunchRoute(path)).toBe("app");
    }
  });
  it("publishes all generated partitions at Next's canonical XML paths", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await response.text()).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <sitemap><loc>https://itrader.im/catalogue/sitemap/0.xml</loc></sitemap>',
      '  <sitemap><loc>https://itrader.im/catalogue/sitemap/1.xml</loc></sitemap>',
      '</sitemapindex>',
    ].join("\n"));
    expect(generateSitemaps).toHaveBeenCalledOnce();
  });

  it.each(["preview", "development", ""])("publishes nothing for %s without loading catalogue partitions", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("<loc>");
    expect(generateSitemaps).not.toHaveBeenCalled();
  });

  it("does not load catalogue partitions while production launch is gated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "0");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(generateSitemaps).not.toHaveBeenCalled();
  });

  it("does not turn a catalogue failure into a successful empty sitemap", async () => {
    generateSitemaps.mockRejectedValue(new Error("catalogue unavailable"));
    await expect(GET()).rejects.toThrow("catalogue unavailable");
  });
});
