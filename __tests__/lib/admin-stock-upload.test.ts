import { beforeEach, describe, expect, it, vi } from "vitest";
const { intent, listing } = vi.hoisted(() => ({ intent: vi.fn(), listing: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { listingImageUploadIntent: { findUnique: intent }, listing: { findFirst: listing } } }));
import { canUploadAdminStockPhoto } from "@/lib/listings/admin-stock-upload";
const admin = { id: "admin", role: "ADMIN" };
beforeEach(() => { vi.resetAllMocks(); listing.mockResolvedValue({ id: "draft" }); intent.mockResolvedValue({ userId: "admin", listingId: "draft" }); });
describe("scoped recalled-stock admin uploads", () => {
  it("requires admin and a held, unsold, nonpreview dealer DRAFT or REJECTED listing", async () => {
    expect(await canUploadAdminStockPhoto({ id: "owner", role: "DEALER" }, { listingId: "draft" })).toBe(false);
    expect(listing).not.toHaveBeenCalled();
    expect(await canUploadAdminStockPhoto(admin, { listingId: "draft" })).toBe(true);
    expect(listing).toHaveBeenCalledWith({ where: { id: "draft", stockReviewHeld: true, status: { in: ["DRAFT", "REJECTED"] },
      dealerId: { not: null }, soldAt: null, previewPackId: null, retentionPurgedAt: null }, select: { id: true } });
  });
  it.each([null, { userId: "foreign", listingId: "draft" }, { userId: "admin", listingId: null }])("rejects missing, foreign or unbound upload intents: %j", async value => {
    intent.mockResolvedValue(value);
    expect(await canUploadAdminStockPhoto(admin, { intentId: "intent" })).toBe(false);
    expect(listing).not.toHaveBeenCalled();
  });
  it("accepts only the actor-owned listing-bound intent and rejects records outside the held scope", async () => {
    expect(await canUploadAdminStockPhoto(admin, { intentId: "intent" })).toBe(true);
    listing.mockResolvedValue(null);
    expect(await canUploadAdminStockPhoto(admin, { intentId: "intent" })).toBe(false);
  });
});
