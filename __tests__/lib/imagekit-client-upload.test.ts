import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadListingImageFile } from "@/lib/images/client-upload";
import { uploadDirectImageKitPhoto } from "@/lib/images/imagekit-client-upload";
const fetchMock = vi.fn<typeof fetch>();
const upload = { provider: "imagekit" as const, strategy: "direct-v2" as const,
  uploadUrl: "https://upload.imagekit.io/api/v2/files/upload", finalizeUrl: "/api/listing-images/imagekit-finalize",
  fields: { token: "test-token", isPrivateFile: "true", overwriteFile: "false", fileName: "source.jpg" } };
const stored = { provider: "IMAGEKIT", uploadIntentId: "intent", publicId: "imagekit/local/user/intent",
  imageKitFileId: "final-file", imageKitFilePath: "/iommarket-media/local/listings/user/intent/photo.jpg", url: "imagekit-private:/iommarket-media/local/listings/user/intent/photo.jpg", width: 800, height: 1200 };

describe("direct ImageKit client integration", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());
  it("sends files larger than the function body limit to ImageKit and only identifiers to our API", async () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], "car.jpg", { type: "image/jpeg" });
    fetchMock.mockResolvedValueOnce(Response.json({ data: { uploadIntentId: "intent", publicId: stored.publicId, upload } }))
      .mockResolvedValueOnce(Response.json({ fileId: "raw-file", width: 1, filePath: "untrusted" }))
      .mockResolvedValueOnce(Response.json({ data: stored }));
    expect(await uploadListingImageFile(file)).toEqual(stored);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ fileName: "car.jpg", fileType: "image/jpeg", fileSize: file.size });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(upload.uploadUrl);
    const body = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect((body.get("file") as File).size).toBe(file.size);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: "omit", redirect: "error" });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ uploadIntentId: "intent", fileId: "raw-file" });
  });
  it("never reuses a rejected one-time token or returns unverified data", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ fileId: "raw-file" }, { status: 400 }));
    await expect(uploadDirectImageKitPhoto(new File(["x"], "car.jpg"), "intent", upload)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a different upload endpoint before transmitting a file", async () => {
    await expect(uploadDirectImageKitPhoto(new File(["x"], "car.jpg"), "intent", { ...upload, uploadUrl: "https://attacker.example" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
