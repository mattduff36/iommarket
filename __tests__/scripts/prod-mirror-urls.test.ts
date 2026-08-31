import { describe, expect, it } from "vitest";
import { rewriteMediaUrlFields, rewritePreviewUserAvatarsUrl } from "../../scripts/prod-mirror/urls";

const previewObject =
  "https://syneonzucehwlghqmfbg.supabase.co/storage/v1/object/public/user-avatars/auth-1/dealer-logos/dealer-1/logo.png";
const productionObject =
  "https://snlqivvogfqesxpbjiei.supabase.co/storage/v1/object/public/user-avatars/auth-1/dealer-logos/dealer-1/logo.png";

describe("PMR-URL-001 rewrite only preview user-avatars public URLs", () => {
  it("rewrites preview user-avatars hosts and preserves the object path", () => {
    expect(rewritePreviewUserAvatarsUrl(previewObject)).toBe(productionObject);
    expect(
      rewriteMediaUrlFields({
        avatarUrl: previewObject,
        logoUrl: previewObject,
      }),
    ).toEqual({
      avatarUrl: productionObject,
      logoUrl: productionObject,
    });
  });

  it("leaves unrelated URLs unchanged", () => {
    const cloudinary = "https://res.cloudinary.com/demo/image/upload/v1/car.jpg";
    const otherBucket =
      "https://syneonzucehwlghqmfbg.supabase.co/storage/v1/object/public/other-bucket/file.png";
    const alreadyProduction = productionObject;
    expect(rewritePreviewUserAvatarsUrl(cloudinary)).toBe(cloudinary);
    expect(rewritePreviewUserAvatarsUrl(otherBucket)).toBe(otherBucket);
    expect(rewritePreviewUserAvatarsUrl(alreadyProduction)).toBe(alreadyProduction);
    expect(rewritePreviewUserAvatarsUrl(null)).toBeNull();
  });
});
