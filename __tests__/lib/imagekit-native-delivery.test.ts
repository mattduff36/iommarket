import { describe, expect, it } from "vitest";
import { imageRecordFromIntent, cleanupDeliveryForRemovedImage } from "@/lib/media/stored-image";
import { signedDeliveryForPhoto, listingSocialMetadataUrl, structuredListingImageUrl } from "@/lib/media/serve-photo";
import { listingPhotoDeliveryUrl } from "@/lib/images/delivery-widths";
import type { ListingPhotoSource } from "@/lib/images/photo";
const path = "/iommarket-media/production/listings/user/intent/photo.jpg";
const intent = { id: "intent", userId: "user", publicId: "imagekit/production/user/intent", deliveryType: "imagekit-managed", folder: "/iommarket-media/production/quarantine/user/intent", imageKitFileId: "native-file", imageKitFilePath: path, assetId: "native-file", version: "source:raw-file", format: "jpg" };
const native: ListingPhotoSource = { ...intent, id: "image-1", provider: "IMAGEKIT", width: 1200, height: 800, url: `imagekit-private:${path}` };
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", MEDIA_PROVIDER: "cloudinary", NEXT_PUBLIC_MEDIA_PROVIDER: "cloudinary", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim", IMAGEKIT_PRIVATE_KEY: "test-private", NEXT_PUBLIC_APP_URL: "https://itrader.im" };

describe("managed native photo identity and rollback", () => {
  it("creates only verified-final native records, never quarantine or mismatched identities", () => {
    expect(imageRecordFromIntent(intent)).toMatchObject({ provider: "IMAGEKIT", url: `imagekit-private:${path}`, imageKitFileId: "native-file", imageKitFilePath: path });
    for (const change of [{ imageKitFilePath: path.replace("/listings/", "/quarantine/") }, { publicId: "imagekit/production/other/intent" }, { userId: "other" }, { imageKitFileId: null }]) {
      expect(() => imageRecordFromIntent({ ...intent, ...change })).toThrow();
    }
  });
  it("serves native originals through ImageKit even when legacy delivery is rolled back", () => {
    const result = signedDeliveryForPhoto({ photo: native, mode: "fit", frame: "gallery", width: 1200, env });
    expect(result.kind).toBe("redirect");
    expect("url" in result ? result.url : "").toContain("ik.imagekit.io/itraderim/");
    expect(listingSocialMetadataUrl("listing-1", native, env)).toContain("/api/media/social/listing-1");
    expect(structuredListingImageUrl({ photo: native, primary: true, env })).toContain("/api/media/listing-photo?");
  });
  it("never signs native quarantine, malformed or swapped identities", () => {
    for (const change of [{ publicId: "imagekit/production/other/intent" }, { imageKitFilePath: path.replace("/listings/", "/quarantine/") }, { imageKitFileId: null }]) {
      expect(signedDeliveryForPhoto({ photo: { ...native, ...change }, mode: "fit", frame: "gallery", width: 1200, env }).kind).toBe("unresolved");
    }
  });
  it("carries native cleanup authority independently of preferred provider", () => {
    expect(cleanupDeliveryForRemovedImage(native)).toMatchObject({ deliveryType: "imagekit-managed", imageKitFilePath: path, imageKitFileId: "native-file" });
    expect(cleanupDeliveryForRemovedImage({ ...native, provider: "EXTERNAL", publicId: "database-sync/readonly" })).toBeNull();
  });
  it("uses the upload intent to preview an unsaved verified photo", () => {
    const source = { uploadIntentId: "intent-1" };
    expect(listingPhotoDeliveryUrl(source, "preview", "fit", 640)).toContain("imageId=intent-1&source=upload");
    expect(listingPhotoDeliveryUrl({ ...source, id: "saved", deliverySource: "revision" }, "gallery", "fit", 640)).toContain("imageId=saved&source=revision");
  });
});
