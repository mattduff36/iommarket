import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageKitDevUploadsEnabled } from "@/lib/media/config";
import { cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";

// No database or cloud calls. These regressions must hold before production cutover.
describe("ImageKit production readiness regressions", () => {
  it("does not enable disposable uploads in a production runtime", () => {
    expect(imageKitDevUploadsEnabled({
      NODE_ENV: "production", VERCEL_ENV: "production", MEDIA_PROVIDER: "imagekit",
      IMAGEKIT_DEV_UPLOADS: "1", NEXT_PUBLIC_APP_URL: "https://itrader.im",
    })).toBe(false);
  });

  it("does not enable disposable uploads against a production database", () => {
    expect(imageKitDevUploadsEnabled({
      NODE_ENV: "test", MEDIA_PROVIDER: "imagekit", IMAGEKIT_DEV_UPLOADS: "1",
      DATABASE_URL: "postgresql://postgres.snlqivvogfqesxpbjiei@aws-1-eu-west-2.pooler.supabase.com/postgres",
    })).toBe(false);
  });

  it("retains intentional isolated disposable uploads", () => {
    expect(imageKitDevUploadsEnabled({
      NODE_ENV: "test", MEDIA_PROVIDER: "imagekit", IMAGEKIT_DEV_UPLOADS: "1",
    })).toBe(true);
  });

  it("keeps both identities when a migrated Cloudinary row is removed", () => {
    const result = cleanupDeliveryForRemovedImage({
      provider: "CLOUDINARY", publicId: "iommarket/listings/staging/user/photo",
      imageKitFileId: "migrated-file", imageKitFilePath: "/iommarket-migration/photo.jpg",
    });
    expect(result).toMatchObject({
      imageKitFileId: "migrated-file", imageKitFilePath: "/iommarket-migration/photo.jpg",
    });
  });

  it("stores decoded dimensions after EXIF auto-rotation", async () => {
    const original = await sharp({ create: {
      width: 1200, height: 800, channels: 3, background: "white",
    } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await stripListingImageMetadata({ bytes: original, format: "jpg" });
    const decoded = await sharp(result.bytes).metadata();
    expect(result.width).toBe(decoded.width);
    expect(result.height).toBe(decoded.height);
    expect([result.width, result.height]).toEqual([800, 1200]);
    expect(decoded.exif).toBeUndefined();
  });

  it("rejects empty images before decoding", async () => {
    await expect(stripListingImageMetadata({ bytes: Buffer.alloc(0), format: "png" }))
      .rejects.toThrow(/empty|read|invalid/i);
  });
});
