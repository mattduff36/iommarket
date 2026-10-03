import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { retiredPreviewResponse } from "@/lib/deployment/retired-preview";

describe("retired preview hostname", () => {
  it.each(["/", "/listings/old", "/robots.txt", "/api/me", "/_next/static/test.js"])("returns a branded true 404 for %s", async (path) => {
    const response = retiredPreviewResponse(new NextRequest(`https://preview.itrader.im${path}`), { VERCEL_ENV: "production" });
    expect(response?.status).toBe(404);
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response?.headers.get("location")).toBeNull();
    expect(await response?.text()).toContain("Visit iTrader.im");
  });
  it("leaves the old signed relay available until its hostname is moved off staging", () => {
    expect(retiredPreviewResponse(new NextRequest("https://preview.itrader.im/api/webhooks/ripple-staging", { method: "POST" }), { VERCEL_ENV: "preview" })).toBeNull();
  });
  it.each(["itrader.im", "staging.itrader.im", "preview.itrader.im.example.com"])("does not retire %s", (host) => {
    expect(retiredPreviewResponse(new NextRequest(`https://${host}/`), { VERCEL_ENV: "production" })).toBeNull();
  });
});
