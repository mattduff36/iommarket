import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_PACK_PHOTO_LIMIT } from "@/lib/preview-packs/limits";
import { encodeNetDirectorImageUrl } from "../../scripts/dealer-stock-sync/image-urls";

const { createSignedListingUploadMock } = vi.hoisted(() => ({
  createSignedListingUploadMock: vi.fn(),
}));

vi.mock("@/lib/upload/cloudinary", () => ({
  createSignedListingUpload: createSignedListingUploadMock,
}));

const {
  enqueuePreviewUploadedImageCleanup,
  previewImageSources,
  uploadPreviewPackImages,
} = await import(
  "@/lib/preview-packs/upload"
);

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
  createSignedListingUploadMock.mockReset();
});

function signedUpload() {
  return {
    cloudName: "demo",
    apiKey: "key",
    timestamp: 1,
    signature: "sig",
    publicId: "iommarket/listings/preview-packs/athol-garage/car-1/attempt-1/0",
    type: "private",
    transformation: "fl_force_strip",
    overwrite: false,
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
  };
}

function cloudinaryOk() {
  return {
    ok: true,
    json: async () => ({
      secure_url: "https://res.cloudinary.com/demo/image.jpg",
      public_id: "iommarket/listings/preview-packs/athol-garage/car-1/attempt-1/0",
      asset_id: "asset-1",
      version: 2,
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 40_000,
    }),
  };
}

describe("previewImageSources", () => {
  it("uses mirrored-disabled archive URLs and caps the gallery", () => {
    const sources = previewImageSources(
      Array.from({ length: 12 }, (_, index) => ({
        originalUrl: `https://cdn.example/car/${index}.jpg`,
        localPath: null,
        contentType: null,
        bytes: null,
        checksum: null,
        status: "skipped" as const,
        error: "image mirroring disabled",
      })),
      ["https://cdn.example/fallback.jpg"],
    );
    expect(sources).toHaveLength(PREVIEW_PACK_PHOTO_LIMIT);
    expect(sources[0]).toEqual({
      localPath: null,
      url: "https://cdn.example/car/0.jpg",
    });
  });

  it("IMG-SOURCE-001 prefers a current full-size URL over an archived thumbnail variant", () => {
    const full = "https://dealer.example/wp-content/uploads/car.jpg";
    const sources = previewImageSources(
      [{
        originalUrl: "https://dealer.example/wp-content/uploads/car-300x200.jpg",
        localPath: "archive/car-thumb.jpg",
        checksum: null,
        bytes: 12_000,
        contentType: "image/jpeg",
        status: "ok",
        error: null,
      }],
      [full],
    );
    expect(sources).toEqual([{ localPath: null, url: full }]);
  });

  it("keeps extensionless NetDirector CDN tokens", () => {
    const token = encodeNetDirectorImageUrl({ key: "ndstock/interior.jpg" });
    expect(previewImageSources([], [token]).map((source) => source.url)).toEqual([token]);
  });

  it("rewrites blocked autofs NetDirector URLs to the Ireland bucket", () => {
    expect(
      previewImageSources(
        [],
        [
          "https://s3-eu-west-1.amazonaws.com/autofs/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png?last_modified=1741879526",
        ],
      ),
    ).toEqual([
      {
        localPath: null,
        url: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png?last_modified=1741879526",
      },
    ]);
  });

  it("drops chrome, share links, and resized thumbs", () => {
    expect(
      previewImageSources(
        [],
        [
          "https://sncc.im/wp-content/themes/cardealer/images/sold-img.png",
          "https://pinterest.com/pin/create/button/?url=https://sncc.im/car",
          "https://img.cdn.dragon2000.net/WebAssets/manufacturer-icons/dark/mercedes-benz.png",
          "https://www.ingearcarsales.co.uk/assets/images/apple-touch-icon.png",
          "https://sncc.im/wp-content/uploads/2026/08/IMG_1038-876x535.jpeg",
          "https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg",
          "https://sncc.im/wp-content/uploads/2026/08/IMG_1049.jpeg",
        ],
      ),
    ).toEqual([
      { localPath: null, url: "https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg" },
      { localPath: null, url: "https://sncc.im/wp-content/uploads/2026/08/IMG_1049.jpeg" },
    ]);
  });

  it("falls back to mapped URLs when the archive has no usable photos", () => {
    expect(
      previewImageSources(
        [
          {
            originalUrl: "https://cdn.example/ignored.gif",
            localPath: null,
            contentType: null,
            bytes: null,
            checksum: null,
            status: "skipped",
            error: "ignored asset",
          },
        ],
        ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      ),
    ).toEqual([
      { localPath: null, url: "https://cdn.example/a.jpg" },
      { localPath: null, url: "https://cdn.example/b.jpg" },
    ]);
  });
});

describe("uploadPreviewPackImages", () => {
  it("uploads validated bytes instead of asking Cloudinary to fetch an unchecked URL", async () => {
    createSignedListingUploadMock.mockReturnValue(signedUpload());
    fetchMock.mockResolvedValue(cloudinaryOk());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const uploaded = await uploadPreviewPackImages({
      dealerKey: "athol-garage",
      identityKey: "car-1",
      attemptId: "attempt-1",
      sources: [{ localPath: null, url: "https://cdn.example/car.jpg" }],
      downloadImpl: async () => ({
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        contentType: "image/jpeg",
      }),
    });

    expect(uploaded).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.cloudinary.com");
    const body = init.body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("uploads local bytes when the archive mirrored the file", async () => {
    createSignedListingUploadMock.mockReturnValue(signedUpload());
    fetchMock.mockResolvedValue(cloudinaryOk());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const dir = join(tmpdir(), `preview-upload-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const localPath = join(dir, "photo.jpg");
    writeFileSync(localPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    await uploadPreviewPackImages({
      dealerKey: "athol-garage",
      identityKey: "car-1",
      attemptId: "attempt-1",
      sources: [{ localPath, url: "https://cdn.example/car.jpg" }],
    });

    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("queues reference-checked cleanup for an uncertain materialization transaction", async () => {
    const createMany = vi.fn();
    const publicId =
      "iommarket/listings/preview-packs/athol-garage/car-1/attempt-1/0";
    await enqueuePreviewUploadedImageCleanup({
      listingImageCleanupJob: { createMany },
    } as never, [{
      url: "https://res.cloudinary.com/demo/new",
      publicId,
      order: 0,
      provider: "CLOUDINARY",
      assetId: "asset-1",
      version: "1",
      width: 1600,
      height: 1200,
      format: "jpg",
      bytes: 80_000,
      ownership: {
        publicId,
        assetId: "asset-1",
        version: "1",
        cloudName: "demo",
        deliveryType: "private",
      },
    }], "transaction-uncertain");
    expect(createMany).toHaveBeenCalledWith({
      data: [{
        publicId,
        deliveryType: "private",
        reason: "transaction-uncertain",
      }],
    });
  });
});
