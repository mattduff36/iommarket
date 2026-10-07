import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";
import type { ListingPhotoSource } from "@/lib/images/photo";

const legacyPhoto: ListingPhotoSource = {
  id: "stored-photo-1",
  url: "https://res.cloudinary.com/untrusted/image/private/v999/other/photo.jpg",
  publicId: "iommarket/listings/production/user/photo",
  provider: "CLOUDINARY",
  version: "1234567890",
  format: "jpg",
  width: 1600,
  height: 1000,
};

const legacyEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  MEDIA_PROVIDER: "imagekit",
  NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
  IMAGEKIT_ALLOW_LEGACY_CLOUDINARY_READS: "1",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
  IMAGEKIT_PRIVATE_KEY: "private_test-value",
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "du3othqre",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
};

function deliver(photo = legacyPhoto, env = legacyEnv) {
  return signedDeliveryForPhoto({ photo, mode: "fit", frame: "gallery", width: 640, env });
}

describe("temporary ImageKit-mode legacy Cloudinary reads", () => {
  it("keeps strict ImageKit behavior unless the exact opt-in is enabled", () => {
    expect(deliver(legacyPhoto, { ...legacyEnv, IMAGEKIT_ALLOW_LEGACY_CLOUDINARY_READS: "0" }).kind).toBe("unresolved");
    expect(deliver(legacyPhoto, { ...legacyEnv, IMAGEKIT_ALLOW_LEGACY_CLOUDINARY_READS: undefined }).kind).toBe("unresolved");
  });

  it("rebuilds and re-signs a trusted private URL from the persisted record", () => {
    const result = deliver();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.url).toContain("https://res.cloudinary.com/du3othqre/image/private/");
    expect(result.url).toContain("v1234567890/iommarket/listings/production/user/photo");
    expect(result.url).not.toContain("untrusted");
    const path = result.url.split("/image/private/")[1]!.replace(/^s--[A-Za-z0-9_-]+--\//, "");
    const expected = createHash("sha1").update(`${path}${legacyEnv.CLOUDINARY_API_SECRET}`).digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 8);
    expect(result.url).toContain(`/image/private/s--${expected}--/${path}`);
  });

  it.each([
    ["missing persisted id", { id: undefined }],
    ["untrusted public id", { publicId: "external/photo" }],
    ["nonnumeric version", { version: "v123" }],
    ["upload source", { deliverySource: "upload" as const }],
    ["partial ImageKit file id", { imageKitFileId: "native-file" }],
    ["partial ImageKit file path", { imageKitFilePath: "/iommarket-media/production/listings/user/intent/photo.jpg" }],
    ["ImageKit public identity", { publicId: "imagekit/production/user/intent" }],
  ])("does not use the fallback for %s", (_label, change) => {
    expect(deliver({ ...legacyPhoto, ...change } as ListingPhotoSource).kind).toBe("unresolved");
  });

  it("does not fallback without the current Cloudinary signing configuration", () => {
    for (const change of [
      { CLOUDINARY_API_KEY: "" },
      { CLOUDINARY_API_SECRET: "" },
      { NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "wrong-cloud" },
    ]) {
      expect(deliver(legacyPhoto, { ...legacyEnv, ...change }).kind).toBe("unresolved");
    }
  });

  it("does not turn an external-provider record into a Cloudinary fallback", () => {
    const photo = { ...legacyPhoto, provider: "EXTERNAL" as const, publicId: "external/user-photo" };
    const result = deliver(photo);
    expect(result.kind).toBe("unresolved");
  });

  it("prefers a verified per-record ImageKit mapping when the fallback is enabled", () => {
    const result = signedDeliveryForPhoto({
      photo: {
        ...legacyPhoto,
        imageKitFileId: "mapped-file",
        imageKitFilePath: "/iommarket-migration/photo.jpg",
      },
      mode: "fit",
      frame: "gallery",
      width: 640,
      env: legacyEnv,
    });
    expect(result.kind).toBe("redirect");
    expect(result.kind === "redirect" ? result.url : "").toContain("ik.imagekit.io/itraderim/tr:w-640,h-400,c-at_max/iommarket-migration/photo.jpg");
  });

  it("does not fallback when the migration map matches but the record lacks verified ImageKit identity", () => {
    const result = signedDeliveryForPhoto({
      photo: { ...legacyPhoto, publicId: "iommarket/listings/staging/user/photo", version: "10", assetId: "asset-1" },
      mode: "fit",
      frame: "gallery",
      width: 640,
      env: {
        ...legacyEnv,
        IMAGEKIT_MIGRATION_MAP: fileURLToPath(new URL("./fixtures/imagekit-migration-map.jsonl", import.meta.url)),
      },
    });
    expect(result.kind).toBe("unresolved");
  });
});
