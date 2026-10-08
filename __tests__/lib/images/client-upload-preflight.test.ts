import { existsSync, readFileSync, statSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateListingImageBounds } from "@/lib/images/constraints";
import {
  preflightListingImageFile,
  undersizedPhotoMessage,
  uploadListingImageFile,
} from "@/lib/images/client-upload";
import { PHOTO_NETWORK_MESSAGE, PHOTO_UNKNOWN_MESSAGE } from "@/lib/media/upload-error-catalog";

const fetchMock = vi.fn<typeof fetch>();

describe("listing image client preflight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("rejects the retained 385 by 294 minimum before any upload", async () => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 385, height: 294, close() {} }));
    const file = new File([new Uint8Array(192957)], "3.png", { type: "image/png" });
    await expect(uploadListingImageFile(file)).rejects.toThrow(
      "3.png is 385×294 pixels. Photos need a long edge of at least 800 pixels and a short edge of at least 480 pixels. Choose a larger original photo.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateListingImageBounds({ width: 385, height: 294, bytes: 192957 })).toBe(
      "Images must be at least 800×480px.",
    );
  });

  it("reads the supplied PNG when it is present locally", async () => {
    expect(undersizedPhotoMessage("3.png", 385, 294)).toContain("Choose a larger original photo.");
    const sample = process.env.LISTING_IMAGE_SAMPLE;
    if (!sample || !existsSync(sample)) return;
    const bytes = readFileSync(sample);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(385);
    expect(meta.height).toBe(294);
    expect(statSync(sample).size).toBe(192957);
  });

  it("accepts a portrait whose long edge is 800 and short edge is 480", async () => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 480, height: 800, close() {} }));
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not start the image upload." }, { status: 500 }));
    const file = new File([new Uint8Array(2000)], "portrait.jpg", { type: "image/jpeg" });
    await expect(preflightListingImageFile(file)).resolves.toBeNull();
    await expect(uploadListingImageFile(file)).rejects.toThrow("Could not start the image upload.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a portrait whose short edge is below 480 before upload", async () => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 294, height: 800, close() {} }));
    await expect(uploadListingImageFile(new File([new Uint8Array(2000)], "tall.png", { type: "image/png" }))).rejects.toThrow(
      /tall\.png is 294×800 pixels/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves HEIF dimensions to the server and still starts the upload", async () => {
    const bitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmap);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not start the image upload." }, { status: 500 }));
    await expect(uploadListingImageFile(new File([new Uint8Array(32)], "car.heic", { type: "image/heic" }))).rejects.toThrow(
      "Could not start the image upload.",
    );
    expect(bitmap).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides a raw provider failure and a network failure", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1600, height: 1000, close() {} }));
    vi.stubGlobal("fetch", fetchMock);
    const upload = {
      cloudName: "cloud",
      apiKey: "key",
      timestamp: 1,
      signature: "sig",
      publicId: "public",
      type: "private",
      transformation: "f_jpg",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    };
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { uploadIntentId: "intent", publicId: "public", upload } }))
      .mockResolvedValueOnce(Response.json({ error: { message: "https://api.cloudinary.com/secret-token" } }, { status: 400 }));
    await expect(uploadListingImageFile(new File([new Uint8Array(2000)], "car.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      PHOTO_UNKNOWN_MESSAGE,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(upload.uploadUrl);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch https://secret.example"));
    await expect(uploadListingImageFile(new File([new Uint8Array(2000)], "car.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      PHOTO_NETWORK_MESSAGE,
    );
  });

  it("says a raster could not be read when decoding fails", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("decode failed");
    });
    await expect(preflightListingImageFile(new File([new Uint8Array(32)], "broken.png", { type: "image/png" }))).resolves.toMatch(
      /broken\.png could not be read/,
    );
  });
});
