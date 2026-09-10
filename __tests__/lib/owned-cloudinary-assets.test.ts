import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOwnedCloudinaryUpload,
  destroyOwnedCloudinaryAssets,
} from "@/lib/upload/owned-cloudinary-assets";
import { deleteImage } from "@/lib/upload/cloudinary";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ASSET-OWN-001 Cloudinary attempt ownership", () => {
  it("requires the exact public ID plus immutable asset metadata", () => {
    expect(() =>
      assertOwnedCloudinaryUpload({
        payload: { public_id: "iommarket/listings/other", asset_id: "asset", version: 1 },
        expectedPublicId: "iommarket/listings/repair/attempt/one",
        expectedCloudName: "cloud",
        allowedPrefix: "iommarket/listings/repair/attempt/",
      }),
    ).toThrow(/ownership/);

    expect(
      assertOwnedCloudinaryUpload({
        payload: {
          public_id: "iommarket/listings/repair/attempt/one",
          asset_id: "asset",
          version: 1,
        },
        expectedPublicId: "iommarket/listings/repair/attempt/one",
        expectedCloudName: "cloud",
        allowedPrefix: "iommarket/listings/repair/attempt/",
      }),
    ).toEqual(expect.objectContaining({
      publicId: "iommarket/listings/repair/attempt/one",
      assetId: "asset",
      version: "1",
      cloudName: "cloud",
      deliveryType: "private",
    }));
  });

  it("refuses deletion before invoking the destructive callback if ownership is uncertain", async () => {
    const destroy = vi.fn();
    await expect(
      destroyOwnedCloudinaryAssets({
        assets: [{
          publicId: "foreign/asset",
          assetId: "asset",
          version: "1",
          cloudName: "cloud",
          deliveryType: "private",
        }],
        cloudName: "cloud",
        allowedPrefix: "iommarket/listings/repair/attempt/",
        destroy,
      }),
    ).rejects.toThrow(/unowned/);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("treats an HTTP 200 destroy error payload as a failed deletion", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "cloud");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      json: async () => ({ result: "error" }),
    }));
    await expect(deleteImage("iommarket/listings/repair/attempt/one")).rejects.toThrow(
      /Failed to delete image/,
    );
  });
});
