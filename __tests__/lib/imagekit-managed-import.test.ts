import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ lock: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), effects: vi.fn(), upload: vi.fn(), clean: vi.fn() }));
vi.mock("@/lib/db", () => {
  const jobs = { findFirst: m.find, create: m.create, updateMany: m.update };
  const tx = { $queryRaw: m.lock, listingImageCleanupJob: jobs };
  return { db: { listingImageCleanupJob: jobs, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) } };
});
vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: m.effects }));
vi.mock("@/lib/media/direct-upload-token", () => ({ assertManagedUploadsConfigured: () => "local" }));
vi.mock("@/lib/media/managed-io", () => ({ uploadImmutableManagedImage: m.upload }));
vi.mock("@/lib/media/strip-metadata", () => ({ stripListingImageMetadata: m.clean }));
import { uploadManagedImport, claimManagedImportsForAttachment } from "@/lib/media/managed-import";
const publicId = "iommarket/listings/preview-packs/dealer/item/run/0";
const path = "/iommarket-media/local/imports/preview-packs/dealer/item/run/0.jpg";
const image = { provider: "IMAGEKIT", publicId, imageKitFileId: "file", imageKitFilePath: path, cleanupReceiptId: "receipt" };
const tx = { $queryRaw: m.lock, listingImageCleanupJob: { updateMany: m.update } };

describe("managed import receipt ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.find.mockResolvedValue(null); m.create.mockResolvedValue({ id: "receipt" });
    m.update.mockResolvedValue({ count: 1 }); m.upload.mockResolvedValue({ fileId: "file" });
    m.clean.mockResolvedValue({ bytes: Buffer.from("clean"), width: 1200, height: 800, format: "jpg", bytesLength: 5 });
    for (const key of ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL"]) vi.stubEnv(key, undefined);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:4010");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("records one immutable ownership receipt before uploading", async () => {
    expect(await uploadManagedImport({ publicId, bytes: Buffer.from("source"), contentType: "image/jpeg", order: 0 })).toMatchObject(image);
    expect(m.lock).toHaveBeenCalled();
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.upload.mock.invocationCallOrder[0]!);
  });
  it("refuses reuse of an import path instead of creating competing cleanup receipts", async () => {
    m.find.mockResolvedValue({ id: "old-receipt" });
    await expect(uploadManagedImport({ publicId, bytes: Buffer.from("source"), contentType: "image/jpeg", order: 0 })).rejects.toThrow(/fresh|already|used/);
    expect(m.upload).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("locks attachment against cleanup and refuses a receipt already claimed by the worker", async () => {
    await claimManagedImportsForAttachment(tx as never, [image]);
    expect(m.lock).toHaveBeenCalled();
    m.update.mockResolvedValue({ count: 0 });
    await expect(claimManagedImportsForAttachment(tx as never, [image])).rejects.toThrow(/already|cleanup/);
  });
  it("rejects attachment of a copied production import from a local environment", async () => {
    await expect(claimManagedImportsForAttachment(tx as never, [{ ...image, imageKitFilePath: path.replace("/local/", "/production/") }])).rejects.toThrow();
    expect(m.update).not.toHaveBeenCalled();
  });
});
