import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, checkRateLimitMock, mockDb } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  mockDb: {
    category: { findUnique: vi.fn() },
    region: { findUnique: vi.fn() },
    listing: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

const validInput = {
  title: "2019 BMW 320d M Sport",
  description: "Low mileage, full service history, excellent condition throughout.",
  price: 1500000,
  categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  regionId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
  trustDeclarationAccepted: true,
  attributes: [],
};

describe("createListing taxonomy ALR-TAX-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "user-1",
      role: "USER",
      dealerProfile: null,
    });
    checkRateLimitMock.mockReturnValue({ allowed: true });
  });

  it("rejects inactive categories and regions before write", async () => {
    mockDb.category.findUnique.mockResolvedValue(null);
    const { createListing } = await import("@/actions/listings");
    await expect(createListing(validInput)).resolves.toEqual({
      error: { categoryId: ["Invalid or inactive category."] },
    });
    expect(mockDb.listing.create).not.toHaveBeenCalled();

    mockDb.category.findUnique.mockResolvedValue({
      slug: "cars",
      attributeDefinitions: [],
    });
    mockDb.region.findUnique.mockResolvedValue(null);
    await expect(createListing(validInput)).resolves.toEqual({
      error: { regionId: ["Invalid or inactive region."] },
    });
  });
});
