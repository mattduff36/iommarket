import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), intent: vi.fn(), listing: vi.fn(), revision: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/db", () => ({ db: { listingImageUploadIntent: { findUnique: m.intent } } }));
vi.mock("@/lib/media/authorize-listing-photo", () => ({ loadAuthorizedListingPhoto: m.listing, loadAuthorizedRevisionPhoto: m.revision }));
import { loadAuthorizedUploadPhoto } from "@/lib/media/authorize-upload-photo";
const intent = {
  id: "intent", userId: "user", publicId: "imagekit/local/user/intent", deliveryType: "imagekit-managed",
  imageKitFileId: "file-1", imageKitFilePath: "/iommarket-media/local/listings/user/intent/photo.jpg",
  folder: "/iommarket-media/local/quarantine/user/intent", status: "VERIFIED", expiresAt: new Date("2099-01-01"),
  assetId: "file-1", version: "source:raw-file", width: 1200, height: 800, format: "jpg", bytes: 100,
  image: null, revisionImage: null,
};

describe("owner-only verified upload previews", () => {
  beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ id: "user" }); m.intent.mockResolvedValue(intent); });
  it("returns final verified identity before a listing exists", async () => {
    await expect(loadAuthorizedUploadPhoto("intent")).resolves.toMatchObject({ provider: "IMAGEKIT", deliverySource: "upload", uploadIntentId: "intent", imageKitFileId: "file-1" });
  });
  it.each([null, { id: "other" }, { id: "admin", role: "ADMIN" }, { id: "user", disabledAt: new Date() }])("rejects a viewer without active ownership: %j", async (viewer) => {
    m.user.mockResolvedValue(viewer);
    expect(await loadAuthorizedUploadPhoto("intent")).toBeNull();
  });
  it.each([{ status: "ISSUED" }, { status: "EXPIRED" }, { expiresAt: new Date(0) }, { imageKitFilePath: "/iommarket-media/local/quarantine/user/intent/source.jpg" }])("does not expose raw or expired uploads: %j", async (change) => {
    m.intent.mockResolvedValue({ ...intent, ...change });
    expect(await loadAuthorizedUploadPhoto("intent")).toBeNull();
  });
  it("rechecks listing visibility after consumption instead of using a permanent preview bypass", async () => {
    m.intent.mockResolvedValue({ ...intent, status: "CONSUMED", image: { id: "image-1" } });
    m.listing.mockResolvedValue(null);
    expect(await loadAuthorizedUploadPhoto("intent")).toBeNull();
    expect(m.listing).toHaveBeenCalledWith("image-1");
    m.intent.mockResolvedValue({ ...intent, status: "CONSUMED" });
    expect(await loadAuthorizedUploadPhoto("intent")).toBeNull();
  });
});
