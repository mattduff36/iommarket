import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignedListingUpload } from "@/lib/upload/cloudinary";
afterEach(() => vi.unstubAllEnvs());

describe("Cloudinary write retirement boundary", () => {
  function configure() {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "du3othqre");
    vi.stubEnv("CLOUDINARY_API_KEY", "test-key"); vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret");
  }
  it("refuses legacy signed uploads when ImageKit is the selected write provider", () => {
    configure(); vi.stubEnv("MEDIA_PROVIDER", "imagekit"); vi.stubEnv("MEDIA_UPLOAD_PROVIDER", "imagekit");
    expect(() => createSignedListingUpload({ publicId: "iommarket/listings/repair/test/0" })).toThrow(/ImageKit|provider/);
  });
  it("keeps the freeze during a read rollback", () => {
    configure(); vi.stubEnv("MEDIA_PROVIDER", "cloudinary"); vi.stubEnv("MEDIA_UPLOAD_PROVIDER", "imagekit");
    expect(() => createSignedListingUpload({ publicId: "iommarket/listings/repair/test/0" })).toThrow();
  });
  it("preserves the original Cloudinary upload path when selected", () => {
    configure(); vi.stubEnv("MEDIA_PROVIDER", "cloudinary"); vi.stubEnv("MEDIA_UPLOAD_PROVIDER", "cloudinary");
    expect(createSignedListingUpload({ publicId: "iommarket/listings/staging/user/intent" }).uploadUrl).toContain("api.cloudinary.com");
  });
});
