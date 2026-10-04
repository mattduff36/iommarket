import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readMediaProviderMode } from "@/lib/media/config";
import { assertDisposableImageKitDelete } from "@/lib/media/delete-guard";
import { focalCoverCrop } from "@/lib/media/focal-crop";
import { signImageKitRelativePath } from "@/lib/media/imagekit-sign";
import {
  imageKitBlurTransform,
  imageKitFitTransform,
  imageKitFillTransform,
  imageKitSocialTransform,
} from "@/lib/media/imagekit-transforms";
import { buildMigrationIndex } from "@/lib/media/migration-index";
import { matchMediaReference } from "@/lib/media/match-reference";
import { decideReferenceDelivery } from "@/lib/media/resolve-delivery";
import { reconcileSourceSnapshot, sourceRecordFromInventory } from "@/lib/media/reconcile-source";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";
import { deleteDisposableImageKitFile } from "@/lib/media/disposable-media";
import { allowsSignedDealerLogo, blocksSignedListingDelivery } from "@/lib/media/delivery-access";

const asset = {
  assetId: "asset-1",
  sourcePublicId: "iommarket/listings/staging/user/photo",
  sourceVersion: "10",
  destinationFileId: "file-1",
  destinationPath: "/iommarket-migration/photo.jpg",
  resourceType: "image",
  format: "jpg",
  sourceBytes: 100,
  sourceSha256: "abc",
  privateVerified: true,
};

describe("ImageKit provider selection", () => {
  it("keeps Cloudinary unless ImageKit is explicitly selected", () => {
    expect(readMediaProviderMode({})).toBe("cloudinary");
    expect(readMediaProviderMode({ MEDIA_PROVIDER: "imagekit" })).toBe("imagekit");
    expect(readMediaProviderMode({ MEDIA_PROVIDER: "unexpected" })).toBe("cloudinary");
  });

  it("does not fall back to Cloudinary for an unmapped reference in imagekit mode", () => {
    const index = buildMigrationIndex([asset]);
    const match = matchMediaReference({ provider: "CLOUDINARY", publicId: "missing", version: "1" }, index);
    expect(decideReferenceDelivery({ match, mode: "imagekit" }).decision).toBe("unresolved");
  });

  it("serves sample files from ImageKit and leaves other originals on Cloudinary", () => {
    const sample = { ...asset, destinationPath: "/iommarket-migration-sample/photo.jpg" };
    const index = buildMigrationIndex([sample]);
    const match = matchMediaReference({ provider: "CLOUDINARY", assetId: "asset-1" }, index);
    expect(decideReferenceDelivery({ match, mode: "imagekit-sample" }).decision).toBe("imagekit");
    const other = matchMediaReference({ provider: "CLOUDINARY", publicId: "other", version: "1" }, index);
    expect(decideReferenceDelivery({ match: other, mode: "imagekit-sample" }).decision).toBe("cloudinary");
  });
});

describe("ImageKit signing and transforms", () => {
  it("signs the relative path and expiry with HMAC-SHA1", () => {
    const expiresAt = 1_800_000_000;
    const relativePath = "tr:w-10,h-10,c-at_max/iommarket-migration/photo.jpg";
    const url = signImageKitRelativePath({
      endpoint: "https://ik.imagekit.io/itraderim",
      privateKey: "test-private",
      relativePath,
      expiresAt,
    });
    const expected = createHmac("sha1", "test-private").update(`${relativePath}${expiresAt}`).digest("hex");
    expect(url).toContain(`ik-s=${expected}`);
    expect(url).toContain("ik-t=1800000000");
    expect(() => signImageKitRelativePath({
      endpoint: "https://ik.imagekit.io/itraderim",
      privateKey: "test-private",
      relativePath: "../secret",
      expiresAt,
    })).toThrow(/cannot be signed/);
  });

  it("maps fit, fill, blur and padded social output to the tested ImageKit chain", () => {
    expect(imageKitFitTransform(640, 400)).toBe("w-640,h-400,c-at_max");
    expect(imageKitBlurTransform(1600, 1000)).toBe("w-320,h-200,c-maintain_ratio,bl-10");
    expect(imageKitSocialTransform({ width: 900, height: 1600 })).toContain("cm-pad_resize,bg-blurred,f-jpg");
    expect(imageKitSocialTransform({ width: 1600, height: 900 })).toContain("w-1200,h-630,c-maintain_ratio,f-jpg");
  });

  it("places a right-edge focal point on the right of a wide image", () => {
    const right = focalCoverCrop({
      sourceWidth: 1000,
      sourceHeight: 500,
      targetWidth: 400,
      targetHeight: 400,
      focalX: 1,
      focalY: 0.5,
    });
    const left = focalCoverCrop({
      sourceWidth: 1000,
      sourceHeight: 500,
      targetWidth: 400,
      targetHeight: 400,
      focalX: 0,
      focalY: 0.5,
    });
    expect(right.x).toBeGreaterThan(left.x);
    expect(right.x + right.width).toBe(1000);
    expect(left.x).toBe(0);
    const transform = imageKitFillTransform({
      width: 400,
      height: 400,
      photo: { width: 1000, height: 500, focalX: 1, focalY: 0.5 },
    });
    expect(transform).toContain("cm-extract");
    expect(transform).toContain(`x-${right.x}`);
  });
});

describe("ImageKit deletion guard", () => {
  const observed = { fileId: "file-1", filePath: "/iommarket-dev-disposable/tests/run/file.jpg" };

  it("refuses migrated, sample and unrecorded files", () => {
    const migrated = { ...observed, filePath: "/iommarket-migration/photo.jpg" };
    const sample = { ...observed, filePath: "/iommarket-migration-sample/photo.jpg" };
    expect(() => assertDisposableImageKitDelete({
      requested: migrated,
      observed: migrated,
      allowlist: [migrated],
    })).toThrow(/disposable/);
    expect(() => assertDisposableImageKitDelete({
      requested: sample,
      observed: sample,
      allowlist: [sample],
    })).toThrow(/disposable/);
    expect(() => assertDisposableImageKitDelete({
      requested: observed,
      observed,
      allowlist: [],
    })).toThrow(/not created/);
  });

  it("does not delete a migrated file when details show a protected path", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(`${init?.method ?? "GET"} ${href}`);
      if (href.includes("/details")) {
        return new Response(JSON.stringify({
          fileId: "migrated-file",
          filePath: "/iommarket-migration/photo.jpg",
          isPrivateFile: true,
          size: 10,
          width: 10,
          height: 10,
          fileType: "image",
        }), { status: 200 });
      }
      return new Response("", { status: 500 });
    }) as typeof fetch;
    await expect(deleteDisposableImageKitFile({
      fileId: "migrated-file",
      allowlist: [{ fileId: "migrated-file", filePath: "/iommarket-migration/photo.jpg" }],
      env: {
        NODE_ENV: "test",
        IMAGEKIT_PRIVATE_KEY: "test-private",
        IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
        IMAGEKIT_DEV_MANIFEST: "tmp/unused-manifest.jsonl",
      },
      fetchImpl,
    })).rejects.toThrow(/disposable/);
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });
});

describe("source reconciliation", () => {
  it("waits for pass 2 and never proposes destination deletes", () => {
    const delta = reconcileSourceSnapshot({ pass2Available: false, baseline: [], pass2: [] });
    expect(delta.status).toBe("pass2-not-available");
    expect(delta.deletionsProposed).toBe(0);
  });

  it("reports added, replaced and missing source records without deleting", () => {
    const baseline = [{
      assetId: "kept",
      sourcePublicId: "kept",
      sourceVersion: "1",
      destinationFileId: "dest-kept",
      destinationPath: "/iommarket-migration/kept.jpg",
      sourceBytes: 10,
      sourceSha256: "a",
    }, {
      assetId: "changed",
      sourcePublicId: "changed",
      sourceVersion: "1",
      destinationFileId: "dest-changed",
      destinationPath: "/iommarket-migration/changed.jpg",
      sourceBytes: 10,
      sourceSha256: "b",
    }, {
      assetId: "gone",
      sourcePublicId: "gone",
      sourceVersion: "1",
      destinationFileId: "dest-gone",
      destinationPath: "/iommarket-migration/gone.jpg",
      sourceBytes: 10,
      sourceSha256: "c",
    }];
    const pass2 = [
      sourceRecordFromInventory({ asset_id: "kept", public_id: "kept", version: 1, bytes: 10 }),
      sourceRecordFromInventory({ asset_id: "changed", public_id: "changed", version: 2, bytes: 12 }),
      sourceRecordFromInventory({ asset_id: "added", public_id: "added", version: 1, bytes: 8 }),
    ];
    const delta = reconcileSourceSnapshot({ pass2Available: true, baseline, pass2 });
    expect(delta.added.map((item) => item.assetId)).toEqual(["added"]);
    expect(delta.replaced.map((item) => item.previous.assetId)).toEqual(["changed"]);
    expect(delta.missingFromPass.map((item) => item.assetId)).toEqual(["gone"]);
    expect(delta.deletionsProposed).toBe(0);
  });
});

describe("reference matching", () => {
  const index = buildMigrationIndex([
    asset,
    { ...asset, assetId: "asset-2", sourceVersion: "11", destinationFileId: "file-2", destinationPath: "/iommarket-migration/photo-v2.jpg" },
  ]);

  it("accepts only an exact asset id or public id plus version", () => {
    expect(matchMediaReference({ provider: "CLOUDINARY", assetId: "asset-1" }, index).kind).toBe("exact-asset-id");
    expect(matchMediaReference({
      provider: "CLOUDINARY",
      publicId: asset.sourcePublicId,
      version: "10",
    }, index).kind).toBe("exact-public-id-version");
    expect(matchMediaReference({
      provider: "CLOUDINARY",
      publicId: asset.sourcePublicId,
    }, index).kind).toBe("ambiguous");
    expect(matchMediaReference({ provider: "EXTERNAL", publicId: "demo/one" }, index).kind).toBe("not-cloudinary");
    expect(matchMediaReference({
      provider: "EXTERNAL",
      publicId: "seed/not-the-cloudinary-id",
      url: "https://res.cloudinary.com/demo/image/private/v10/iommarket/listings/staging/user/photo.jpg",
    }, index).kind).toBe("exact-public-id-version");
  });
});

describe("listing upload formats", () => {
  it("rejects MP4 and states that HEIC stripping is unavailable", async () => {
    await expect(stripListingImageMetadata({ bytes: Buffer.from("not-a-video"), format: "mp4" })).rejects.toThrow(/MP4/);
    await expect(stripListingImageMetadata({ bytes: Buffer.from("heic"), format: "heic" })).rejects.toThrow(/HEIC\/HEIF/);
  });
});

describe("signed delivery access", () => {
  const hiddenSample = {
    privateListings: false,
    dealerListings: false,
  };

  it("withholds hidden sample listings even when the status check would allow them", () => {
    expect(blocksSignedListingDelivery({
      authUserId: "00000000-0000-0000-0000-000000000001",
      dealerId: "dealer-1",
      isAdminPreview: false,
      sampleVisibility: hiddenSample,
      canView: true,
    })).toBe(true);
  });

  it("allows a visible listing the viewer is permitted to open", () => {
    expect(blocksSignedListingDelivery({
      authUserId: "real-user",
      dealerId: "dealer-1",
      isAdminPreview: false,
      sampleVisibility: hiddenSample,
      canView: true,
    })).toBe(false);
  });

  it("signs a dealer logo only when that stored logo is public or the viewer is an admin", () => {
    const logo = {
      storedLogo: true,
      authUserId: "real-user",
      isAdminPreview: false,
      sampleVisibility: hiddenSample,
      ownerDisabled: false,
      publiclyVisible: false,
      viewerIsAdmin: false,
    };
    expect(allowsSignedDealerLogo({ ...logo, storedLogo: false, publiclyVisible: true })).toBe(false);
    expect(allowsSignedDealerLogo(logo)).toBe(false);
    expect(allowsSignedDealerLogo({ ...logo, publiclyVisible: true })).toBe(true);
    expect(allowsSignedDealerLogo({ ...logo, viewerIsAdmin: true })).toBe(true);
  });

  it("does not sign a hidden sample dealer logo for an admin", () => {
    expect(allowsSignedDealerLogo({
      storedLogo: true,
      authUserId: "00000000-0000-0000-0000-000000000001",
      isAdminPreview: false,
      sampleVisibility: hiddenSample,
      ownerDisabled: false,
      publiclyVisible: false,
      viewerIsAdmin: true,
    })).toBe(false);
  });
});
