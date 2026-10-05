import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";

const image = () => sharp({ create: {
  width: 1200, height: 800, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0.5 },
} });

describe("ImageKit metadata and orientation", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("records output dimensions for EXIF orientation %i", async (orientation) => {
    const bytes = await image().jpeg().withMetadata({ orientation }).toBuffer();
    const result = await stripListingImageMetadata({ bytes, format: "jpg" });
    const metadata = await sharp(result.bytes).metadata();
    const expected = orientation >= 5 ? [800, 1200] : [1200, 800];
    expect([result.width, result.height]).toEqual(expected);
    expect([metadata.width, metadata.height]).toEqual(expected);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(result.bytesLength).toBe(result.bytes.length);
  });

  it.each(["png", "webp"] as const)("preserves transparency in %s while stripping metadata", async (format) => {
    const bytes = await image().toFormat(format).withMetadata().toBuffer();
    const result = await stripListingImageMetadata({ bytes, format });
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe(format);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect([result.width, result.height]).toEqual([1200, 800]);
  });

  it("rejects mismatched actual and declared file formats", async () => {
    const bytes = await image().png().toBuffer();
    await expect(stripListingImageMetadata({ bytes, format: "jpg" })).rejects.toThrow(/invalid|unsupported/);
  });

  it("does not decode vector input disguised as a raster", async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>');
    await expect(stripListingImageMetadata({ bytes, format: "png" })).rejects.toThrow(/invalid|unsupported/);
  });

  it("rejects over-limit inputs before processing", async () => {
    await expect(stripListingImageMetadata({
      bytes: Buffer.alloc(IMAGE_CONSTRAINTS.maxFileSizeBytes + 1), format: "jpg",
    })).rejects.toThrow(/10MB/);
  });

  it("rejects undersized decoded images", async () => {
    const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: "white" } }).png().toBuffer();
    await expect(stripListingImageMetadata({ bytes, format: "png" })).rejects.toThrow(/dimensions/);
  });
});
