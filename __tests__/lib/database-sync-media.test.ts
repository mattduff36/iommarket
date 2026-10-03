import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitiseSourceMedia } from "@/lib/database-sync/media";
import { SYNC_TABLES, type SyncDataset, type SyncRow } from "@/lib/database-sync/types";
import { buildListingPhotoUrl, buildSocialImageUrl, getSocialImageDimensions } from "@/lib/images/cloudinary-url";
import { toListingPhotoSource } from "@/lib/images/photo";
import { deleteImage, signCloudinaryDeliveryPath, signPrivateCloudinaryUrl } from "@/lib/upload/cloudinary";
import { assertOwnedListingAsset } from "@/lib/upload/owned-cloudinary-assets";
import { getOwnedDealerLogoStoragePath } from "@/lib/upload/dealer-logo";
import { DATABASE_SYNC_REFERENCE_FRAGMENT, isDatabaseSyncReference } from "@/lib/images/database-sync-reference";

const row: SyncRow = { id: "image-1", listingId: "listing-1", provider: "CLOUDINARY", publicId: "iommarket/listings/production/car/photo", url: "https://res.cloudinary.com/owned/image/private/v123/iommarket/listings/production/car/photo.jpg", version: "123", format: "jpg", width: 960, height: 720, assetId: "production-asset", uploadIntentId: "production-intent" };
function dataset(image = row): SyncDataset {
  return { ...Object.fromEntries(SYNC_TABLES.map((table) => [table, []])) as unknown as SyncDataset, ListingImage: [image] };
}
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "owned"); vi.stubEnv("CLOUDINARY_API_SECRET", "unit-test-signing-value"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("database sync read-only media references", () => {
  it("converts owned images into stable signed external references without cleanup ownership", () => {
    const source = dataset();
    const image = sanitiseSourceMedia(source).ListingImage[0]!;
    expect(image).toMatchObject({ id: row.id, listingId: row.listingId, provider: "EXTERNAL", width: 960, height: 720, assetId: null, uploadIntentId: null });
    expect(image.publicId).toMatch(/^database-sync\/[a-f0-9]{64}$/);
    expect(image.publicId).not.toMatch(/^iommarket\/listings\//);
    const path = "v123/iommarket/listings/production/car/photo.jpg";
    const signature = signCloudinaryDeliveryPath(path, "unit-test-signing-value");
    expect(image.url).toBe(`https://res.cloudinary.com/owned/image/private/s--${signature}--/${path}`);
    expect(signPrivateCloudinaryUrl(String(image.url))).toBe(image.url);
    expect(source.ListingImage[0]).toEqual(row);
    expect(sanitiseSourceMedia(source)).toEqual(sanitiseSourceMedia(source));
    expect(sanitiseSourceMedia(sanitiseSourceMedia(source))).toEqual(sanitiseSourceMedia(source));
    expect(() => assertOwnedListingAsset({ asset: { publicId: String(image.publicId), assetId: "", cloudName: "owned", version: "123", deliveryType: "private" }, cloudName: "owned" })).toThrow();
  });

  it("keeps copied EXTERNAL images on the existing non-transforming display path", () => {
    const image = sanitiseSourceMedia(dataset()).ListingImage[0]!;
    const photo = toListingPhotoSource(image as unknown as Parameters<typeof toListingPhotoSource>[0])!;
    expect(buildListingPhotoUrl(photo, { width: 640, mode: "fill", frame: "card" })).toBe(image.url);
    expect(buildSocialImageUrl(photo)).toBe(image.url);
    expect(getSocialImageDimensions(photo)).toEqual({ width: 960, height: 720 });
  });

  it("also namespaces external references and drops stale ownership fields", () => {
    const image = sanitiseSourceMedia(dataset({ ...row, provider: "EXTERNAL", publicId: "demo/1", url: "https://example.com/car.png" })).ListingImage[0]!;
    expect(image).toMatchObject({ provider: "EXTERNAL", url: "https://example.com/car.png", assetId: null, uploadIntentId: null });
    expect(image.publicId).toMatch(/^database-sync\//);
  });

  const invalidChanges: SyncRow[] = [
    { url: "http://example.com/image.jpg" }, { url: "https://user:pass@example.com/image.jpg" }, { url: "https://127.0.0.1/image.jpg" },
    { url: "https://res.cloudinary.com/other/image/private/asset" }, { publicId: "../unsafe" }, { version: "1/unsafe" },
  ];
  it.each(invalidChanges)("rejects unverified source metadata %j", (change) => {
    expect(() => sanitiseSourceMedia(dataset({ ...row, ...change }))).toThrow();
  });

  it("fails closed if the private image cannot be signed", () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    expect(() => sanitiseSourceMedia(dataset())).toThrow("Production image delivery could not be verified");
  });

  it("uses explicitly supplied signing configuration without mutating process environment", () => {
    const before = process.env.CLOUDINARY_API_SECRET;
    const image = sanitiseSourceMedia(dataset(), { NODE_ENV: "test", NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "owned", CLOUDINARY_API_SECRET: "isolated-test-value" }).ListingImage[0]!;
    expect(image.url).toContain(`s--${signCloudinaryDeliveryPath("v123/iommarket/listings/production/car/photo.jpg", "isolated-test-value")}--`);
    expect(process.env.CLOUDINARY_API_SECRET).toBe(before);
  });

  it("production Supabase logo URLs never resolve to a staging-owned deletion path", () => {
    expect(getOwnedDealerLogoStoragePath({ logoUrl: "https://snlqivvogfqesxpbjiei.supabase.co/storage/v1/object/public/user-avatars/auth/dealer-logos/dealer/logo.png", supabaseUrl: "https://syneonzucehwlghqmfbg.supabase.co", authUserId: "auth", dealerId: "dealer" })).toBeNull();
  });

  it("never sends a destruction request for a sync reference, even through legacy account cleanup", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    await expect(deleteImage(`database-sync/${"a".repeat(64)}`)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not sign an external host or another Cloudinary account", () => {
    for (const url of ["https://evil.example/image/private/asset", "https://res.cloudinary.com/other/image/private/asset"]) {
      expect(signPrivateCloudinaryUrl(url)).toBe(url);
    }
  });

  it("marks verified Cloudinary dealer logos as read-only media references", () => {
    const input = dataset();
    input.DealerProfile = [{ id: "dealer", isAdminPreview: false, logoUrl: "https://res.cloudinary.com/owned/image/upload/dealer-logo.png" }];
    const output = sanitiseSourceMedia(input, process.env, new Set(["dealer"]));
    expect(output.DealerProfile[0]?.logoUrl).toBe(`https://res.cloudinary.com/owned/image/upload/dealer-logo.png${DATABASE_SYNC_REFERENCE_FRAGMENT}`);
    expect(isDatabaseSyncReference(output.DealerProfile[0]?.logoUrl as string)).toBe(true);
  });

  it("does not touch excluded dealer logos and rejects Cloudinary logos from another account", () => {
    const input = dataset();
    input.DealerProfile = [{ id: "excluded", isAdminPreview: false, logoUrl: "https://res.cloudinary.com/other/image/upload/logo.png" }];
    expect(sanitiseSourceMedia(input, process.env, new Set()).DealerProfile[0]?.logoUrl).toContain("/other/");
    expect(() => sanitiseSourceMedia(input, process.env, new Set(["excluded"]))).toThrow("could not be verified");
  });
});
