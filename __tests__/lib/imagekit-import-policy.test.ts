import { describe, expect, it } from "vitest";
import { managedImportPath, parseManagedMediaPath, managedMediaPublicId, isManagedListingPath } from "@/lib/media/managed-policy";
import { imageRecordFromIntent, cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";
import { signedDeliveryForPhoto, listingSocialMetadataUrl } from "@/lib/media/serve-photo";
const publicId = "iommarket/listings/preview-packs/dealer/identity/run-123/0";

describe("ImageKit import identity compatibility", () => {
  it("retains the logical preview identity used by resume and audit workflows", () => {
    const path = managedImportPath("staging", publicId, "jpg");
    expect(path).toBe("/iommarket-media/staging/imports/preview-packs/dealer/identity/run-123/0.jpg");
    expect(parseManagedMediaPath(path)?.kind).toBe("imports");
    expect(managedMediaPublicId(path)).toBe(publicId);
    expect(isManagedListingPath(path)).toBe(true);
  });
  it("rejects traversal and unowned logical namespaces", () => {
    for (const id of [publicId.replace("identity", ".."), "other/cloud/file", publicId.replace("0", "../1")]) expect(() => managedImportPath("local", id, "jpg")).toThrow();
  });
  it("delivers imported ImageKit assets during rollback and queues the correct provider cleanup", () => {
    const path = managedImportPath("production", publicId, "png");
    const photo = { id: "image-1", publicId, provider: "IMAGEKIT" as const, url: `imagekit-private:${path}`, imageKitFileId: "file-1", imageKitFilePath: path, width: 1200, height: 800 };
    const env = { NODE_ENV: "test" as const, MEDIA_PROVIDER: "cloudinary", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim", IMAGEKIT_PRIVATE_KEY: "test-private", NEXT_PUBLIC_APP_URL: "https://itrader.im" };
    expect(signedDeliveryForPhoto({ photo, mode: "fit", frame: "gallery", width: 1200, env }).kind).toBe("redirect");
    expect(listingSocialMetadataUrl("listing", photo, env)).toContain("/api/media/social/listing");
    expect(cleanupDeliveryForRemovedImage(photo)).toMatchObject({ deliveryType: "imagekit-managed", imageKitFilePath: path });
    expect(() => imageRecordFromIntent({ ...photo, id: "run-123", userId: "dealer", assetId: "file-1", version: "1", format: "png", deliveryType: "imagekit-managed", folder: "ignored" })).toThrow();
  });
});
