import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  claimFreeListingSlotMock,
  transitionListingStatusMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  claimFreeListingSlotMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  mockDb: {
    listing: {
      findUnique: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/config/marketplace", () => ({
  claimFreeListingSlot: claimFreeListingSlotMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

describe("submitListingForReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
    });
    mockDb.payment.findFirst.mockResolvedValue(null);
    claimFreeListingSlotMock.mockResolvedValue({ status: "already-claimed" });
  });

  it("requires payment when the account has already used its free listing", async () => {
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(submitListingForReview("listing_123")).resolves.toEqual({
      error:
        "Your one free listing has already been used. Complete payment for this listing to submit it.",
    });

    expect(claimFreeListingSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        listingId: "listing_123",
      })
    );
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
  });

  it("requires payment to renew a free listing", async () => {
    const { submitListingForReview } = await import("@/actions/listings");
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      expiresAt: new Date("2025-01-01T00:00:00Z"),
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
    });
    await expect(submitListingForReview("listing_123")).resolves.toEqual({
      error: "Payment is required to renew an expired listing.",
    });

    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
  });
});
