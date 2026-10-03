import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { setNodeEnv } from "@/__tests__/lib/seo-test-env";
import {
  classifyDeployment,
  isSearchIndexingEnabled,
  PREVIEW_INDEX_REMOVAL_PHASE,
  shouldNoindexHtmlResponse,
} from "@/lib/seo/indexing-policy";

const original = {
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
  launch: process.env.PRODUCTION_LAUNCH_ENABLED,
};

afterEach(() => {
  setNodeEnv(original.node);
  if (original.vercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original.vercel;
  if (original.launch === undefined) delete process.env.PRODUCTION_LAUNCH_ENABLED;
  else process.env.PRODUCTION_LAUNCH_ENABLED = original.launch;
});

describe("search indexing policy", () => {
  it("indexes production only when the launch gate is open", () => {
    expect(isSearchIndexingEnabled({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      PRODUCTION_LAUNCH_ENABLED: "1",
      HOST: "preview.itrader.im",
    })).toBe(true);
    expect(isSearchIndexingEnabled({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    }, Date.parse("2026-10-03T08:00:00Z"))).toBe(false);
  });

  it("blocks preview, local, test and unknown deployments, including a spoofed host", () => {
    expect(PREVIEW_INDEX_REMOVAL_PHASE).toBe("crawlable-noindex");
    expect(classifyDeployment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("preview");
    expect(isSearchIndexingEnabled({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      HOST: "itrader.im",
    })).toBe(false);
    expect(isSearchIndexingEnabled({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(isSearchIndexingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isSearchIndexingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isSearchIndexingEnabled({})).toBe(false);
  });

  it("noindexes utility routes in production and all HTML on preview", () => {
    const production = { VERCEL_ENV: "production", NODE_ENV: "production", PRODUCTION_LAUNCH_ENABLED: "1" };
    expect(shouldNoindexHtmlResponse("/search", production)).toBe(false);
    expect(shouldNoindexHtmlResponse("/sell-on-the-isle-of-man", production)).toBe(false);
    expect(shouldNoindexHtmlResponse("/sign-in", production)).toBe(true);
    expect(shouldNoindexHtmlResponse("/sell", production)).toBe(true);
    expect(shouldNoindexHtmlResponse("/pay/success", production)).toBe(true);
    expect(shouldNoindexHtmlResponse("/api/advertising/events", production)).toBe(false);
    expect(shouldNoindexHtmlResponse("/listings/abc", { VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
  });

  it("sets a preview noindex header without using the request host", async () => {
    process.env.VERCEL_ENV = "preview";
    setNodeEnv("production");
    const response = await proxy(new NextRequest("https://itrader.im/holding"));
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
