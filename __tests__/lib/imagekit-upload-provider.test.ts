import { describe, expect, it } from "vitest";
import { readMediaUploadProvider } from "@/lib/media/upload-provider";

describe("independent media write preference", () => {
  it("keeps legacy Cloudinary unless a supported provider is selected", () => {
    expect(readMediaUploadProvider({})).toBe("cloudinary");
    expect(readMediaUploadProvider({ MEDIA_PROVIDER: "imagekit" })).toBe("imagekit");
  });
  it("keeps ImageKit writes available during an explicit delivery rollback", () => {
    expect(readMediaUploadProvider({ MEDIA_PROVIDER: "cloudinary", MEDIA_UPLOAD_PROVIDER: "imagekit" })).toBe("imagekit");
  });
  it("does not silently write Cloudinary assets under strict ImageKit delivery", () => {
    expect(() => readMediaUploadProvider({ MEDIA_PROVIDER: "imagekit", MEDIA_UPLOAD_PROVIDER: "cloudinary" })).toThrow();
  });
  it("rejects mistyped configuration and implicit sample-mode writes", () => {
    expect(() => readMediaUploadProvider({ MEDIA_PROVIDER: "typo" })).toThrow();
    expect(() => readMediaUploadProvider({ MEDIA_UPLOAD_PROVIDER: "typo" })).toThrow();
    expect(() => readMediaUploadProvider({ MEDIA_PROVIDER: "imagekit-sample" })).toThrow();
  });
});
