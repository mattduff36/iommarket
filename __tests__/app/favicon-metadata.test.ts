import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faviconIcons, faviconManifest, faviconThemeColor } from "@/lib/seo/favicons";

const publicDir = join(process.cwd(), "public");

describe("favicon package", () => {
  it("points metadata at the generated favicon formats", () => {
    expect(faviconIcons).toEqual({
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      ],
      shortcut: "/favicon.ico",
      apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    });
    expect(faviconManifest).toBe("/site.webmanifest");
    expect(faviconThemeColor).toBe("#050405");

    const layoutSource = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layoutSource).toContain("faviconIcons");
    expect(layoutSource).toContain("faviconManifest");
    expect(layoutSource).toContain("faviconThemeColor");
  });

  it("describes the PWA icons in the web manifest", () => {
    const manifest = JSON.parse(readFileSync(join(publicDir, "site.webmanifest"), "utf8"));

    expect(manifest).toMatchObject({
      name: "iTrader.im",
      short_name: "iTrader",
      theme_color: "#050405",
      background_color: "#050405",
      display: "standalone",
      start_url: "/",
    });
    expect(manifest.icons).toEqual([
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ]);
  });
});
