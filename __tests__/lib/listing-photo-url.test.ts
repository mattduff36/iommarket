import { afterEach, describe, expect, it } from "vitest";
import {
  buildListingPhotoUrl,
  buildSocialImageUrl,
  getListingPhotoSignaturePayload,
  isTrustedListingPublicId,
} from "@/lib/images/cloudinary-url";
import { createSignedListingUpload, signPrivateCloudinaryUrl } from "@/lib/upload/cloudinary";
import type { ListingPhotoSource } from "@/lib/images/photo";

const photo: ListingPhotoSource = {
  url: "https://example.com/original.jpg",
  publicId: "iommarket/listings/staging/user/photo-1",
  provider: "CLOUDINARY",
  version: "1710000001",
  width: 900,
  height: 1600,
  format: "jpg",
};

describe("PHOTO-URL-001 listing photo URLs", () => {
  const previous = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  afterEach(() => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = previous;
  });

  it("encodes public IDs, pins versions and never rewrites untrusted sources", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    expect(isTrustedListingPublicId("iommarket/listings/ok")).toBe(true);
    expect(isTrustedListingPublicId("other/folder/ok")).toBe(false);
    expect(isTrustedListingPublicId("iommarket/listings/../secret")).toBe(false);

    const url = buildListingPhotoUrl(photo, {
      width: 610,
      mode: "fit",
      frame: "gallery",
    });
    expect(url).toContain("https://res.cloudinary.com/demo-cloud/image/private/");
    expect(url).toContain("c_fit,w_640,h_400");
    expect(url).toContain("/v1710000001/iommarket/listings/staging/user/photo-1");
    expect(url).not.toContain("example.com/original.jpg");

    expect(
      buildListingPhotoUrl(
        { ...photo, publicId: "evil/id" },
        { width: 640, mode: "fill", frame: "card" },
      ),
    ).toBe(photo.url);
  });

  it("builds a crawler-safe 1200x630 JPEG for padded social images", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const url = buildSocialImageUrl(photo);
    expect(url).toContain("w_1200,h_630");
    expect(url).toContain("e_blur:800");
    expect(url).toContain("f_jpg");
    expect(url).toContain("l_private:iommarket:listings:staging:user:photo-1");
  });

  it("PHOTO-SOCIAL-001 and PHOTO-COMPAT-001 expose a private-layer social path that can be signed", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const { path } = getListingPhotoSignaturePayload(photo, {
      width: 1200,
      mode: "social",
      frame: "social",
    });
    expect(path).toContain("l_private:");
    expect(path).toContain("f_jpg");

    const previousSecret = process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    const signed = signPrivateCloudinaryUrl(buildSocialImageUrl(photo));
    process.env.CLOUDINARY_API_SECRET = previousSecret;
    expect(signed).toMatch(/\/image\/private\/s--[A-Za-z0-9_-]{8}--\//);
  });

  it("strips incoming metadata without disabling EXIF orientation", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
    const upload = createSignedListingUpload({
      publicId: "iommarket/listings/staging/user/photo-1",
    });
    expect(upload.transformation).toBe("fl_force_strip");
    expect(upload.transformation).not.toContain("a_ignore");
  });

  it("PHOTO-PERF-001 keeps blur derivatives tiny and never requests the original source", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const url = buildListingPhotoUrl(photo, {
      width: 1600,
      mode: "blur",
      frame: "gallery",
    });
    expect(url).toContain("w_320");
    expect(url).toContain("e_blur:800");
    expect(url).not.toContain("example.com/original.jpg");
  });
});
