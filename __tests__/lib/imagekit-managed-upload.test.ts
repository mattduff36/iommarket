import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), create: vi.fn(), update: vi.fn(), cleanupCreate: vi.fn(), cleanupMany: vi.fn(),
  details: vi.fn(), download: vi.fn(), upload: vi.fn(), clean: vi.fn(), effects: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const db = {
    listingImageUploadIntent: { findUnique: mocks.find, create: mocks.create, updateMany: mocks.update },
    listingImageCleanupJob: { create: mocks.cleanupCreate, createMany: mocks.cleanupMany },
  };
  return { db: { ...db, $transaction: async (callback: (tx: typeof db) => Promise<unknown>) => callback(db) } };
});
vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: mocks.effects }));
vi.mock("@/lib/media/managed-io", () => ({
  requireManagedFileDetails: mocks.details, downloadManagedImageKitBytes: mocks.download, uploadImmutableManagedImage: mocks.upload,
}));
vi.mock("@/lib/media/strip-metadata", () => ({ stripListingImageMetadata: mocks.clean }));

import { finalizeManagedImageKitUpload, issueManagedImageKitUploadIntent } from "@/lib/media/managed-upload";
const rawPath = "/iommarket-media/local/quarantine/user/intent/source.jpg";
const finalPath = "/iommarket-media/local/listings/user/intent/photo.jpg";
const intent = {
  id: "intent", userId: "user", publicId: "imagekit/local/user/intent", deliveryType: "imagekit-managed",
  folder: "/iommarket-media/local/quarantine/user/intent", imageKitFilePath: rawPath, imageKitFileId: null,
  status: "ISSUED", format: "jpg", bytes: 6, expiresAt: new Date("2099-01-01T00:00:00Z"),
};
const request = { userId: "user", intentId: "intent", fileId: "raw-file" };

describe("managed ImageKit intent lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "NEXT_PUBLIC_SUPABASE_URL", "VERCEL_ENV"]) vi.stubEnv(key, undefined);
    for (const [key, value] of Object.entries({
      NODE_ENV: "test", DATABASE_URL: "postgresql://test@localhost/test", NEXT_PUBLIC_APP_URL: "http://localhost:4010",
      MEDIA_PROVIDER: "imagekit", NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit", IMAGEKIT_UPLOADS_ENABLED: "1",
      IMAGEKIT_PUBLIC_KEY: "test-public", IMAGEKIT_PRIVATE_KEY: "test-private", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    })) vi.stubEnv(key, value);
    mocks.find.mockResolvedValue(intent);
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.create.mockImplementation(async ({ data }) => data);
    mocks.details.mockResolvedValue({ fileId: "raw-file", filePath: rawPath, size: 6, width: 1200, height: 800 });
    mocks.download.mockResolvedValue(Buffer.from("source"));
    mocks.clean.mockResolvedValue({ bytes: Buffer.from("clean"), width: 800, height: 1200, format: "jpg", bytesLength: 5 });
    mocks.upload.mockResolvedValue({ fileId: "final-file", filePath: finalPath });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records raw and final cleanup receipts before issuing the direct-upload token", async () => {
    const issued = await issueManagedImageKitUploadIntent("user", { fileName: "car.jpg", fileType: "image/jpeg", fileSize: 6 });
    expect(issued.upload.strategy).toBe("direct-v2");
    expect(mocks.cleanupMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ deliveryType: "imagekit-managed", reason: "managed-upload-abandoned", imageKitFilePath: expect.stringContaining("/quarantine/user/") }),
      expect.objectContaining({ deliveryType: "imagekit-managed", reason: "managed-upload-abandoned", imageKitFilePath: expect.stringContaining("/listings/user/") }),
    ] });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ deliveryType: "imagekit-managed" }) });
  });

  it.each([
    { fileName: "car.heic", fileType: "image/heif" },
    { fileName: "car.heif", fileType: "image/heic" },
  ])("accepts provider MIME aliases within the HEIC/HEIF family: %j", async ({ fileName, fileType }) => {
    const issued = await issueManagedImageKitUploadIntent("user", { fileName, fileType, fileSize: 6 });
    expect(issued.intent.format).toBe(fileName.endsWith(".heic") ? "heic" : "heif");
  });

  it.each([
    { fileName: "car.png", fileType: "image/heif" },
    { fileName: "car.heic", fileType: "image/heic-sequence" },
  ])("rejects MIME values outside the filename's supported family: %j", async ({ fileName, fileType }) => {
    await expect(issueManagedImageKitUploadIntent("user", { fileName, fileType, fileSize: 6 })).rejects.toThrow(/filename and type/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("attaches only independently sanitized and verified immutable bytes", async () => {
    const result = await finalizeManagedImageKitUpload(request);
    expect(mocks.clean).toHaveBeenCalledWith({ bytes: Buffer.from("source"), format: "jpg" });
    expect(mocks.upload).toHaveBeenCalledWith({ filePath: finalPath, bytes: Buffer.from("clean") });
    expect(result).toMatchObject({ status: "VERIFIED", version: "source:raw-file", imageKitFileId: "final-file", imageKitFilePath: finalPath, width: 800, height: 1200 });
    expect(mocks.cleanupCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ imageKitFileId: "raw-file", imageKitFilePath: rawPath, reason: "managed-verified-quarantine" }) });
  });

  it.each([
    { userId: "other" }, { status: "REJECTED" }, { expiresAt: new Date(0) },
    { imageKitFilePath: "/iommarket-migration/photo.jpg" }, { imageKitFileId: "different-file" },
  ])("rejects mismatched or unavailable intents before processing: %j", async (change) => {
    mocks.find.mockResolvedValue({ ...intent, ...change });
    await expect(finalizeManagedImageKitUpload(request)).rejects.toThrow();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("accepts matching PNG dimensions and rejects a changed edge", async () => {
    const pngPath = rawPath.replace(".jpg", ".png");
    mocks.find.mockResolvedValue({ ...intent, format: "png", imageKitFilePath: pngPath });
    mocks.details.mockResolvedValue({ fileId: "raw-file", filePath: pngPath, size: 6, width: 1200, height: 800 });
    mocks.clean.mockResolvedValue({ bytes: Buffer.from("clean"), width: 1200, height: 800, format: "png", bytesLength: 5 });
    await expect(finalizeManagedImageKitUpload(request)).resolves.toMatchObject({ status: "VERIFIED", format: "png", width: 1200, height: 800 });
    mocks.clean.mockResolvedValue({ bytes: Buffer.from("clean"), width: 1199, height: 800, format: "png", bytesLength: 5 });
    await expect(finalizeManagedImageKitUpload(request)).rejects.toThrow(/do not agree/);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("rejects a raw file with a different authoritative size", async () => {
    mocks.details.mockResolvedValue({ size: 7 });
    await expect(finalizeManagedImageKitUpload(request)).rejects.toThrow(/size/);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("replays the same verified file without an external write", async () => {
    mocks.find.mockResolvedValue({ ...intent, status: "VERIFIED", version: "source:raw-file", imageKitFileId: "final-file", imageKitFilePath: finalPath });
    await expect(finalizeManagedImageKitUpload(request)).resolves.toMatchObject({ imageKitFileId: "final-file" });
    await expect(finalizeManagedImageKitUpload({ ...request, fileId: "substitute" })).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("refuses to publish when the intent expires during sanitization", async () => {
    mocks.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.find.mockResolvedValueOnce(intent).mockResolvedValueOnce({ ...intent, status: "EXPIRED" });
    await expect(finalizeManagedImageKitUpload(request)).rejects.toThrow(/state changed/);
    expect(mocks.cleanupCreate).not.toHaveBeenCalled();
  });

  it("converts a signed HEIF original before metadata stripping", async () => {
    const heifPath = "/iommarket-media/local/quarantine/user/intent/source.heif";
    const bytes = Buffer.alloc(20);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("heic", 8, "ascii");
    mocks.find.mockResolvedValue({
      ...intent,
      format: "heif",
      bytes: bytes.length,
      imageKitFilePath: heifPath,
    });
    mocks.details.mockResolvedValue({
      fileId: "raw-file",
      filePath: heifPath,
      size: bytes.length,
      width: 1200,
      height: 800,
    });
    mocks.download.mockImplementation(async (input: { convertHeif?: boolean }) =>
      input.convertHeif ? Buffer.from("converted-webp") : bytes);
    mocks.clean.mockResolvedValue({
      bytes: Buffer.from("clean"),
      width: 1200,
      height: 800,
      format: "webp",
      bytesLength: 5,
    });
    await expect(finalizeManagedImageKitUpload(request)).resolves.toMatchObject({ status: "VERIFIED", format: "webp" });
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ convertHeif: true }));
    expect(mocks.clean).toHaveBeenCalledWith({ bytes: Buffer.from("converted-webp"), format: "webp" });
  });

  it("lets a cloned actor upload and finalize a new staging file without dropping path checks", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres.syneonzucehwlghqmfbg@aws-0.pooler.supabase.com/postgres");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://syneonzucehwlghqmfbg.supabase.co");
    mocks.effects.mockRejectedValue(new Error("Cloned production records cannot trigger external effects from staging."));
    const issued = await issueManagedImageKitUploadIntent("cloned-user", {
      fileName: "car.jpg", fileType: "image/jpeg", fileSize: 6,
    });
    const created = issued.intent;
    expect(created.publicId).toBe(`imagekit/staging/cloned-user/${created.id}`);
    expect(created.imageKitFilePath).toBe(`/iommarket-media/staging/quarantine/cloned-user/${created.id}/source.jpg`);
    const stagingIntent = {
      ...intent, ...created, userId: "cloned-user", status: "ISSUED", imageKitFileId: "raw-file",
      bytes: 6, format: "jpg", expiresAt: new Date("2099-01-01T00:00:00Z"),
    };
    mocks.find.mockResolvedValue({
      ...stagingIntent,
      publicId: `imagekit/production/cloned-user/${created.id}`,
      imageKitFilePath: `/iommarket-media/production/quarantine/cloned-user/${created.id}/source.jpg`,
    });
    await expect(finalizeManagedImageKitUpload({
      userId: "cloned-user", intentId: created.id, fileId: "raw-file",
    })).rejects.toThrow(/identity changed/);
    mocks.find.mockResolvedValue({ ...stagingIntent, userId: "other" });
    await expect(finalizeManagedImageKitUpload({
      userId: "cloned-user", intentId: created.id, fileId: "raw-file",
    })).rejects.toThrow(/not found/);
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue(stagingIntent);
    mocks.details.mockResolvedValue({
      fileId: "raw-file", filePath: stagingIntent.imageKitFilePath, size: 6, width: 1200, height: 800,
    });
    await expect(finalizeManagedImageKitUpload({
      userId: "cloned-user", intentId: created.id, fileId: "substitute",
    })).rejects.toThrow(/identity changed/);
    await expect(finalizeManagedImageKitUpload({
      userId: "cloned-user", intentId: created.id, fileId: "raw-file",
    })).resolves.toMatchObject({
      status: "VERIFIED",
      imageKitFilePath: `/iommarket-media/staging/listings/cloned-user/${created.id}/photo.jpg`,
    });
    expect(mocks.upload).toHaveBeenCalledWith({
      filePath: `/iommarket-media/staging/listings/cloned-user/${created.id}/photo.jpg`,
      bytes: Buffer.from("clean"),
    });
    expect(mocks.effects).not.toHaveBeenCalled();
  });
});
