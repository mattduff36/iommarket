import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAcceptedAuthMock, checkRateLimitMock, mockDb } = vi.hoisted(() => ({
  requireAcceptedAuthMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  mockDb: {
    category: { findUnique: vi.fn() },
    region: { findUnique: vi.fn() },
    listing: { create: vi.fn(), count: vi.fn() },
    listingStatusEvent: { create: vi.fn() },
    subscription: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: vi.fn(
    (scope: string, identifier: string) => `${scope}:${identifier}`,
  ),
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
  reportHandledException: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const validInput = {
  title: "2019 BMW 320d M Sport",
  description: "Low mileage, full service history, excellent condition throughout.",
  price: 1500000,
  categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  regionId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
  trustDeclarationAccepted: true,
  attributes: [],
  flow: "private" as const,
};

describe("createListing taxonomy ALR-TAX-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedAuthMock.mockResolvedValue({
      id: "user-1",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: null,
    });
    checkRateLimitMock.mockReturnValue({ allowed: true });
    mockDb.category.findUnique.mockResolvedValue({
      slug: "van",
      attributeDefinitions: [],
    });
    mockDb.region.findUnique.mockResolvedValue({ id: validInput.regionId });
    mockDb.$transaction.mockImplementation(
      async (callback: (transaction: typeof mockDb) => unknown) =>
        callback(mockDb),
    );
    mockDb.listing.create.mockResolvedValue({
      id: "cllisting123456789012345678",
      ...validInput,
      status: "DRAFT",
    });
    mockDb.listingStatusEvent.create.mockResolvedValue({ id: "event-1" });
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

  it("LST-ATTR-SCOPE-001 persists a deterministic known ID and drops unknown IDs", async () => {
    const deterministicId = "attr_writeoff_cmn3oefbu0001twzjvgysi1k5";
    mockDb.category.findUnique.mockResolvedValue({
      slug: "van",
      attributeDefinitions: [
        {
          id: deterministicId,
          slug: "write-off-category",
          name: "Insurance write-off category",
          dataType: "select",
          required: false,
          options: JSON.stringify(["None", "Category N", "Category S"]),
        },
      ],
    });

    const { createListing } = await import("@/actions/listings");
    await expect(
      createListing({
        ...validInput,
        attributes: [
          { attributeDefinitionId: deterministicId, value: "None" },
          { attributeDefinitionId: "unknown_but_bounded", value: "Category N" },
        ],
      }),
    ).resolves.toMatchObject({
      data: { id: "cllisting123456789012345678" },
    });

    expect(mockDb.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attributeValues: {
          create: [
            {
              attributeDefinitionId: deterministicId,
              value: "None",
            },
          ],
        },
      }),
    });
    expect(
      JSON.stringify(mockDb.listing.create.mock.calls[0]?.[0]),
    ).not.toContain("unknown_but_bounded");
  });
});

describe("createListing admin access T4 T11", () => {
  const listingInput = {
    title: "2019 BMW 320d M Sport",
    description: "Low mileage, full service history, excellent condition throughout.",
    price: 1500000,
    categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    regionId: "clyyyyyyyyyyyyyyyyyyyyyyyyy",
    trustDeclarationAccepted: true,
    attributes: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockReturnValue({ allowed: true });
    mockDb.category.findUnique.mockResolvedValue({
      slug: "cars",
      attributeDefinitions: [],
    });
    mockDb.region.findUnique.mockResolvedValue({ id: listingInput.regionId });
    mockDb.subscription.findFirst.mockResolvedValue(null);
    mockDb.listing.count.mockResolvedValue(0);
    mockDb.$transaction.mockImplementation(
      async (callback: (transaction: typeof mockDb) => unknown) =>
        callback(mockDb),
    );
    mockDb.listing.create.mockResolvedValue({
      id: "cllisting123456789012345678",
      status: "DRAFT",
    });
    mockDb.listingStatusEvent.create.mockResolvedValue({ id: "event-1" });
  });

  it("lets an admin create a private listing with dealerId null", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      dealerProfile: { id: "dealer-admin", tier: "STARTER" },
    });
    const { createListing } = await import("@/actions/listings");
    await expect(
      createListing({ ...listingInput, flow: "private" }),
    ).resolves.toMatchObject({
      data: { id: "cllisting123456789012345678" },
    });
    expect(mockDb.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealerId: null,
        userId: "admin-1",
      }),
    });
    expect(mockDb.listing.count).not.toHaveBeenCalled();
  });

  it("lets an admin create a dealer listing without billing entitlement or cap", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      dealerProfile: { id: "dealer-admin", tier: "STARTER" },
    });
    mockDb.listing.count.mockResolvedValue(999);
    const { createListing } = await import("@/actions/listings");
    await expect(
      createListing({ ...listingInput, flow: "dealer" }),
    ).resolves.toMatchObject({
      data: { id: "cllisting123456789012345678" },
    });
    expect(mockDb.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealerId: "dealer-admin",
        userId: "admin-1",
      }),
    });
    expect(mockDb.listing.count).not.toHaveBeenCalled();
  });

  it("rejects unpaid dealer creates and wrong-flow roles", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-1",
      email: "dealer@example.com",
      role: "DEALER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    const { createListing } = await import("@/actions/listings");
    await expect(
      createListing({ ...listingInput, flow: "dealer" }),
    ).resolves.toEqual({
      error: "Active dealer access is required to post listings.",
    });
    await expect(
      createListing({ ...listingInput, flow: "private" }),
    ).resolves.toEqual({
      error: "Dealer accounts must use the dealer listing flow.",
    });

    requireAcceptedAuthMock.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "USER",
      dealerProfile: null,
    });
    await expect(
      createListing({ ...listingInput, flow: "dealer" }),
    ).resolves.toEqual({
      error: "A dealer account is required to post dealer listings.",
    });
    expect(mockDb.listing.create).not.toHaveBeenCalled();
  });
});

