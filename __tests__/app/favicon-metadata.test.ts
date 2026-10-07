import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { faviconIcons, faviconManifest, faviconThemeColor } from "@/lib/seo/favicons";

const rootDir = process.cwd();
const publicDir = join(rootDir, "public");
const approvedMaster = join(rootDir, "brand-assets/source/itrader-icon-a.png");

async function rawPixels(input: Buffer | string) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function expectSamePixels(expected: Buffer | string, actual: Buffer | string) {
  const expectedPixels = await rawPixels(expected);
  const actualPixels = await rawPixels(actual);
  expect(actualPixels.width).toBe(expectedPixels.width);
  expect(actualPixels.height).toBe(expectedPixels.height);
  expect(actualPixels.channels).toBe(expectedPixels.channels);
  expect(actualPixels.data).toEqual(expectedPixels.data);
}

async function resizedMaster(size: number) {
  return sharp(approvedMaster)
    .flatten({ background: "#000000" })
    .resize(size, size)
    .png()
    .toBuffer();
}

describe("favicon package", () => {
  it("points metadata at the versioned favicon formats", () => {
    expect(faviconIcons).toEqual({
      icon: [
        {
          url: "/favicon.ico?v=itrader-a-20261007",
          sizes: "16x16 32x32 48x48 64x64 128x128 256x256",
          type: "image/x-icon",
        },
        { url: "/favicon-32x32.png?v=itrader-a-20261007", sizes: "32x32", type: "image/png" },
        { url: "/favicon.svg?v=itrader-a-20261007", sizes: "any", type: "image/svg+xml" },
      ],
      shortcut: "/favicon.ico?v=itrader-a-20261007",
      apple: { url: "/apple-touch-icon.png?v=itrader-a-20261007", sizes: "180x180", type: "image/png" },
    });
    expect(faviconManifest).toBe("/site.webmanifest?v=itrader-a-20261007");
    expect(faviconThemeColor).toBe("#050405");

    const layoutSource = readFileSync(join(rootDir, "app/layout.tsx"), "utf8");
    expect(layoutSource).toContain("faviconIcons");
    expect(layoutSource).toContain("faviconManifest");
    expect(layoutSource).toContain("faviconThemeColor");
  });

  it("describes the standard and maskable PWA icons in the web manifest", () => {
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
      { src: "/icon-192.png?v=itrader-a-20261007", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=itrader-a-20261007", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png?v=itrader-a-20261007", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png?v=itrader-a-20261007", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("keeps served PNG icons as exact resizes of the approved master", async () => {
    for (const [path, size] of [
      ["app/icon.png", 48],
      ["app/apple-icon.png", 180],
      ["public/apple-touch-icon.png", 180],
      ["public/apple-touch-icon-precomposed.png", 180],
      ["public/favicon-16x16.png", 16],
      ["public/favicon-32x32.png", 32],
      ["public/icon-192.png", 192],
      ["public/icon-512.png", 512],
      ["public/images/icon-itrader.png", 512],
      ["public/images/icon-itrader-trans.png", 512],
    ] as const) {
      await expectSamePixels(await resizedMaster(size), join(rootDir, path));
    }
  });

  it("uses opaque black backgrounds for Apple icons and removes the public ICO collision", async () => {
    for (const path of ["app/apple-icon.png", "public/apple-touch-icon.png", "public/apple-touch-icon-precomposed.png"]) {
      const imagePath = join(rootDir, path);
      const metadata = await sharp(imagePath).metadata();
      expect(metadata.width).toBe(180);
      expect(metadata.height).toBe(180);
      expect(metadata.hasAlpha).not.toBe(true);
      await expectSamePixels(await resizedMaster(180), imagePath);
    }

    expect(existsSync(join(publicDir, "favicon.ico"))).toBe(false);
    expect(existsSync(join(rootDir, "app/favicon.ico"))).toBe(true);
  });

  it("stores every ICO frame at its declared size with approved-master pixels", async () => {
    const ico = readFileSync(join(rootDir, "app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const frameCount = ico.readUInt16LE(4);
    const expectedSizes = [16, 32, 48, 64, 128, 256];
    expect(frameCount).toBe(expectedSizes.length);

    for (let index = 0; index < frameCount; index += 1) {
      const entry = 6 + index * 16;
      const size = ico[entry] || 256;
      const height = ico[entry + 1] || 256;
      const byteLength = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(size).toBe(expectedSizes[index]);
      expect(height).toBe(size);
      expect(offset + byteLength).toBeLessThanOrEqual(ico.length);

      const frame = ico.subarray(offset, offset + byteLength);
      const frameMetadata = await sharp(frame).metadata();
      expect(frameMetadata.width).toBe(size);
      expect(frameMetadata.height).toBe(size);
      await expectSamePixels(await resizedMaster(size), frame);
    }
  });

  it("keeps the maskable artwork inside the central safe area", async () => {
    for (const size of [192, 512]) {
      const insetSize = Math.floor(size * 0.56);
      const inset = await resizedMaster(insetSize);
      const expected = await sharp({
        create: { width: size, height: size, channels: 3, background: "#000000" },
      })
        .composite([{ input: inset, gravity: "centre" }])
        .png()
        .toBuffer();
      await expectSamePixels(expected, join(publicDir, `icon-maskable-${size}.png`));
    }
  });
});
