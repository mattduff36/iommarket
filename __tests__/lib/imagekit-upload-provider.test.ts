import { afterEach, describe, expect, it, vi } from "vitest";
import { hasVerifiedImageKitUploadIdentity, readMediaUploadProvider, uploadIntentCanBeAttached } from "@/lib/media/upload-provider";

describe("independent media write preference", () => {
  afterEach(() => vi.unstubAllEnvs());
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

  it("allows only intents with a concrete ImageKit identity after the write cutover", () => {
    vi.stubEnv("MEDIA_PROVIDER", "cloudinary");
    vi.stubEnv("MEDIA_UPLOAD_PROVIDER", "imagekit");

    const managed = {
      id: "intent-1",
      userId: "user-1",
      deliveryType: "imagekit-managed",
      publicId: "imagekit/staging/user-1/intent-1",
      imageKitFileId: "file-1",
      imageKitFilePath: "/iommarket-media/staging/listings/user-1/intent-1/photo.jpg",
    };
    const disposable = {
      id: "intent-2",
      userId: "user-1",
      deliveryType: "imagekit",
      publicId: "imagekit-dev/file-2",
      imageKitFileId: "file-2",
      imageKitFilePath: "/iommarket-dev-disposable/user-1/intent-2/photo.jpg",
      folder: "/iommarket-dev-disposable/user-1/intent-2",
    };

    expect(hasVerifiedImageKitUploadIdentity(managed)).toBe(true);
    expect(uploadIntentCanBeAttached(disposable)).toBe(true);
    expect(uploadIntentCanBeAttached({
      deliveryType: "private",
      publicId: "iommarket/listings/staging/user-1/intent-3",
    })).toBe(false);
    expect(uploadIntentCanBeAttached({
      deliveryType: "imagekit",
      publicId: "imagekit-dev/file-4",
    })).toBe(false);
  });
});
