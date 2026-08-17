import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  transitionListingStatusMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: { count: vi.fn() },
    dealerProfile: { count: vi.fn() },
    report: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    payment: { count: vi.fn() },
    category: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    attributeDefinition: { create: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(),
}));

describe("moderateListing ALR-LST-003 ALR-IDN-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: "listing-1", status: "REJECTED" },
      notification: null,
    });
  });

  it("rejects unauthorized callers", async () => {
    requireRoleMock.mockRejectedValue(new Error("Forbidden"));
    const { moderateListing } = await import("@/actions/admin");
    await expect(
      moderateListing({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        action: "REJECT",
        expectedRevision: 0,
        reasonCode: "FRAUD",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("passes reason and revision into the lifecycle service", async () => {
    const { moderateListing } = await import("@/actions/admin");
    const result = await moderateListing({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "REJECT",
      expectedRevision: 2,
      reasonCode: "FRAUD",
      moderationSubReason: "fraud.identity-or-ownership",
      moderationTaxonomyVersion: "2026-08-17.1",
      adminNotes: "Test notes",
    });
    expect(result.data).toBeDefined();
    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REJECT",
        expectedRevision: 2,
        reasonCode: "FRAUD",
        moderationSubReason: "fraud.identity-or-ownership",
        moderationTaxonomyVersion: "2026-08-17.1",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    );
  });
});
