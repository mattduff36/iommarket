import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faviconIcons, faviconManifest, faviconThemeColor } from "@/lib/seo/favicons";

const publicDir = join(process.cwd(), "public");

function readPngHeader(fileName: string) {
  const buffer = readFileSync(join(publicDir, fileName));
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

function readIcoSizes(fileName: string) {
  const buffer = readFileSync(join(publicDir, fileName));
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const width = buffer[entry] === 0 ? 256 : buffer[entry];
    const height = buffer[entry + 1] === 0 ? 256 : buffer[entry + 1];
    return { width, height };
  });
}

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

  it("publishes every required favicon file", () => {
    for (const fileName of [
      "favicon.svg",
      "favicon.ico",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "site.webmanifest",
    ]) {
      expect(existsSync(join(publicDir, fileName)), fileName).toBe(true);
    }
  });

  it("uses the expected raster sizes and an opaque iOS icon", () => {
    expect(readPngHeader("apple-touch-icon.png")).toMatchObject({
      width: 180,
      height: 180,
      colorType: 2,
    });
    expect(readPngHeader("icon-192.png")).toMatchObject({ width: 192, height: 192 });
    expect(readPngHeader("icon-512.png")).toMatchObject({ width: 512, height: 512 });
    expect(readIcoSizes("favicon.ico")).toEqual(
      expect.arrayContaining([
        { width: 16, height: 16 },
        { width: 32, height: 32 },
      ]),
    );
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
