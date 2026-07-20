import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  isPrivateListingFreeForUserMock,
  transitionListingStatusMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isPrivateListingFreeForUserMock: vi.fn(),
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
  isPrivateListingFreeForUser: isPrivateListingFreeForUserMock,
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
    isPrivateListingFreeForUserMock.mockResolvedValue(false);
  });

  it("requires payment when the account has already used its free listing", async () => {
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(submitListingForReview("listing_123")).resolves.toEqual({
      error:
        "Your one free listing has already been used. Complete payment for this listing to submit it.",
    });

    expect(isPrivateListingFreeForUserMock).toHaveBeenCalledWith("user_123");
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
  });
});
