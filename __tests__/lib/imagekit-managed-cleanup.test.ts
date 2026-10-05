import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ lock: vi.fn(), intent: vi.fn(), expire: vi.fn(), live: vi.fn(), revision: vi.fn(), receipt: vi.fn(), find: vi.fn(), remove: vi.fn(), effects: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: m.lock, listingImageUploadIntent: { findUnique: m.intent, updateMany: m.expire }, listingImage: { findFirst: m.live }, listingRevisionImage: { findFirst: m.revision } };
  return { db: { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx), listingImageCleanupJob: { updateMany: m.receipt } } };
});
vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: m.effects }));
vi.mock("@/lib/media/managed-io", () => ({ findManagedFileByPath: m.find, deleteManagedImageKitFile: m.remove }));
import { processManagedCleanupReceipt } from "@/lib/media/managed-cleanup";
const path = "/iommarket-media/local/listings/user/intent/photo.jpg";
const job = { id: "job", publicId: "imagekit/local/user/intent", imageKitFileId: "file-1", imageKitFilePath: path };
const intent = { id: "intent", userId: "user", publicId: job.publicId, deliveryType: "imagekit-managed", status: "VERIFIED", expiresAt: new Date(0), imageKitFilePath: path };

describe("managed cleanup lifecycle safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL"]) vi.stubEnv(key, undefined);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:4010");
    m.intent.mockResolvedValue(intent); m.expire.mockResolvedValue({ count: 1 }); m.receipt.mockResolvedValue({ count: 1 });
    m.live.mockResolvedValue(null); m.revision.mockResolvedValue(null); m.find.mockResolvedValue({ fileId: "file-1", filePath: path });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("expires a detached verified intent under a row lock before deleting its file", async () => {
    await expect(processManagedCleanupReceipt(job)).resolves.toEqual({ status: "deleted" });
    expect(m.lock).toHaveBeenCalled();
    expect(m.expire).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ image: { is: null }, revisionImage: { is: null } }), data: { status: "EXPIRED" } }));
    expect(m.remove).toHaveBeenCalledWith({ fileId: "file-1", filePath: path, allowlist: [{ fileId: "file-1", filePath: path }] });
  });
  it("defers unexpired verified uploads and a lost expiry race", async () => {
    m.intent.mockResolvedValueOnce({ ...intent, expiresAt: new Date("2099-01-01") });
    expect((await processManagedCleanupReceipt(job)).status).toBe("deferred");
    m.expire.mockResolvedValueOnce({ count: 0 });
    expect((await processManagedCleanupReceipt(job)).status).toBe("deferred");
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("retains any live or open-revision reference even after the upload intent is consumed", async () => {
    m.intent.mockResolvedValue({ ...intent, status: "CONSUMED" });
    m.revision.mockResolvedValueOnce({ id: "revision-image" });
    expect((await processManagedCleanupReceipt(job)).status).toBe("referenced");
    m.live.mockResolvedValueOnce({ id: "live-image" });
    expect((await processManagedCleanupReceipt(job)).status).toBe("referenced");
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("recovers and persists only the exact receipt path after a lost upload response", async () => {
    await processManagedCleanupReceipt({ ...job, imageKitFileId: null });
    expect(m.find).toHaveBeenCalledWith({ filePath: path });
    expect(m.receipt).toHaveBeenCalledWith(expect.objectContaining({ data: { imageKitFileId: "file-1" } }));
  });
  it("rejects cross-environment or owner-mismatched receipts before deletion", async () => {
    await expect(processManagedCleanupReceipt({ ...job, imageKitFilePath: path.replace("/local/", "/production/") })).rejects.toThrow();
    m.intent.mockResolvedValueOnce({ ...intent, userId: "other" });
    await expect(processManagedCleanupReceipt(job)).rejects.toThrow(/owner/);
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("can delete verified quarantine without treating the final image as the raw-file reference", async () => {
    const raw = path.replace("/listings/", "/quarantine/").replace("photo.jpg", "source.jpg");
    m.intent.mockResolvedValueOnce({ ...intent, expiresAt: new Date("2099-01-01") });
    expect((await processManagedCleanupReceipt({ ...job, imageKitFilePath: raw })).status).toBe("deleted");
    expect(m.expire).not.toHaveBeenCalled();
  });
});
