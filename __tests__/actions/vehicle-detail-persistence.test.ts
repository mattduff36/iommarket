import { beforeEach, describe, expect, it, vi } from "vitest";
import { attributeDefsForCategory } from "@/prisma/seed/catalog-attributes";

const listingId = "clh7h6lk80000qwertyuiopas";
const regionId = "clh7h6lk80002qwertyuiopas";
const vanCategoryId = "van-category";
const motorhomeCategoryId = "motorhome-category";

const {
  requireAuthMock,
  requireRoleMock,
  checkRateLimitMock,
  getOpenRevisionMock,
  updateDraftRevisionMock,
  logAdminActionMock,
  reportHandledExceptionMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireRoleMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  getOpenRevisionMock: vi.fn(),
  updateDraftRevisionMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  reportHandledExceptionMock: vi.fn(),
  mockDb: {
    category: { findUnique: vi.fn() },
    region: { findUnique: vi.fn() },
    listing: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    listingAttributeValue: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    listingStatusEvent: { create: vi.fn() },
    listingRevision: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAuthMock,
  acceptedAuthHttpStatus: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: (scope: string, id: string) => `${scope}:${id}`,
}));
vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
  reportHandledException: reportHandledExceptionMock,
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/listings/revisions", () => ({
  getOpenRevision: getOpenRevisionMock,
  getOrCreateDraftRevision: vi.fn(),
  submitRevision: vi.fn(),
  updateDraftRevision: updateDraftRevisionMock,
}));

function definitions(category: "van" | "motorhome" | "car") {
  return attributeDefsForCategory(category).map((attribute) => ({
    id: `${category}_${attribute.slug}`,
    ...attribute,
  }));
}

function value(category: "van" | "motorhome", slug: string, attributeValue: string) {
  return { attributeDefinitionId: `${category}_${slug}`, value: attributeValue };
}

const requiredVan = [
  value("van", "make", "Ford"),
  value("van", "model", "Transit Custom"),
  value("van", "year", "2019"),
  value("van", "mileage", "42000"),
];

const requiredMotorhome = [
  value("motorhome", "make", "Swift"),
  value("motorhome", "model", "Kon-Tiki"),
  value("motorhome", "year", "2018"),
  value("motorhome", "mileage", "21000"),
];

const baseListing = {
  title: "Ford Transit Custom",
  description: "A panel van with optional load-area details.",
  price: 1_850_000,
  categoryId: vanCategoryId,
  regionId,
  trustDeclarationAccepted: true,
};

describe("motorhome and van detail persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLICY_ENFORCE_LISTING_NS;
    requireAuthMock.mockResolvedValue({ id: "user_123", email: "seller@example.com", role: "USER" });
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      unavailable: false,
    });
    mockDb.region.findUnique.mockResolvedValue({ id: regionId, active: true });
    mockDb.category.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      slug: where.id === motorhomeCategoryId ? "motorhome" : "van",
      active: true,
      attributeDefinitions: definitions(where.id === motorhomeCategoryId ? "motorhome" : "van"),
    }));
    mockDb.listing.create.mockResolvedValue({ id: listingId });
    mockDb.listing.update.mockResolvedValue({ id: listingId });
    mockDb.listing.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listing.findUniqueOrThrow.mockResolvedValue({
      lifecycleRevision: 4,
      updatedAt: new Date("2026-10-08T12:00:00.000Z"),
    });
    mockDb.listingAttributeValue.deleteMany.mockResolvedValue({ count: 1 });
    mockDb.listingAttributeValue.createMany.mockResolvedValue({ count: 1 });
    mockDb.listingAttributeValue.findMany.mockResolvedValue([]);
    mockDb.listingRevision.findFirst.mockResolvedValue(null);
    mockDb.$queryRaw.mockResolvedValue([
      { id: listingId, lifecycleRevision: 2, updatedAt: new Date("2026-10-08T12:00:00.000Z") },
    ]);
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb),
    );
    updateDraftRevisionMock.mockResolvedValue({ id: listingId, version: 2 });
  });

  it("creates a van listing with a visible tail-lift capacity", async () => {
    const { createListing } = await import("@/actions/listings");
    const attributes = [
      ...requiredVan,
      value("van", "tail-lift", "Yes"),
      value("van", "tail-lift-capacity-kg", "500"),
    ];

    const result = await createListing({ ...baseListing, flow: "private", attributes });

    expect(result).toEqual({ data: { id: listingId } });
    expect(mockDb.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributeValues: {
            create: expect.arrayContaining([
              { attributeDefinitionId: "van_tail-lift", value: "Yes" },
              { attributeDefinitionId: "van_tail-lift-capacity-kg", value: "500" },
            ]),
          },
        }),
      }),
    );
  });

  it("rejects a hidden tail-lift capacity before any listing write", async () => {
    const { createListing } = await import("@/actions/listings");
    const result = await createListing({
      ...baseListing,
      flow: "private",
      attributes: [
        ...requiredVan,
        value("van", "tail-lift", "No"),
        value("van", "tail-lift-capacity-kg", "500"),
      ],
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        "attr-van_tail-lift-capacity-kg": [
          expect.stringContaining("Tail lift is Yes"),
        ],
      }),
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("clears a draft attribute by replacing the saved rows", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      categoryId: vanCategoryId,
      status: "DRAFT",
      trustDeclarationAcceptedAt: new Date("2026-10-01T00:00:00.000Z"),
      lifecycleRevision: 1,
    });
    mockDb.listingAttributeValue.findMany.mockResolvedValue([
      value("van", "tail-lift", "Yes"),
      value("van", "tail-lift-capacity-kg", "500"),
    ]);
    const { updateListing } = await import("@/actions/listings");

    const result = await updateListing({
      id: listingId,
      categoryId: vanCategoryId,
      attributes: [...requiredVan, value("van", "tail-lift", "No")],
    });

    expect(result).toEqual({ data: { id: listingId } });
    expect(mockDb.listingAttributeValue.deleteMany).toHaveBeenCalledWith({
      where: { listingId },
    });
    const created = mockDb.listingAttributeValue.createMany.mock.calls[0][0].data as Array<{
      attributeDefinitionId: string;
    }>;
    expect(created.map((row) => row.attributeDefinitionId)).not.toContain(
      "van_tail-lift-capacity-kg",
    );
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attributeDefinitionId: "van_tail-lift", value: "No" }),
      ]),
    );
  });

  it("keeps an open revision body type and ignores a client-only retained claim", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      categoryId: motorhomeCategoryId,
      status: "LIVE",
      trustDeclarationAcceptedAt: new Date("2026-10-01T00:00:00.000Z"),
      lifecycleRevision: 3,
    });
    getOpenRevisionMock.mockResolvedValue({
      id: "revision-1",
      version: 4,
      categoryId: motorhomeCategoryId,
      attributeValues: [value("motorhome", "body-type", "Hatchback")],
    });
    const { updateListing } = await import("@/actions/listings");

    const kept = await updateListing({
      id: listingId,
      categoryId: motorhomeCategoryId,
      attributes: [...requiredMotorhome, value("motorhome", "body-type", "Hatchback")],
    });
    expect(kept.error).toBeUndefined();
    expect(updateDraftRevisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.arrayContaining([value("motorhome", "body-type", "Hatchback")]),
      }),
    );

    updateDraftRevisionMock.mockClear();
    const forged = await updateListing({
      id: listingId,
      categoryId: motorhomeCategoryId,
      attributes: [...requiredMotorhome, value("motorhome", "body-type", "Saloon")],
    });
    expect(forged.error).toEqual(
      expect.objectContaining({
        "attr-motorhome_body-type": [expect.stringContaining("motorhome type")],
      }),
    );
    expect(updateDraftRevisionMock).not.toHaveBeenCalled();
    expect(mockDb.listingAttributeValue.findMany).not.toHaveBeenCalled();
  });

  it("does not inherit a body type after the category changes", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      categoryId: motorhomeCategoryId,
      status: "LIVE",
      trustDeclarationAcceptedAt: null,
      lifecycleRevision: 3,
    });
    getOpenRevisionMock.mockResolvedValue({
      id: "revision-1",
      version: 4,
      categoryId: motorhomeCategoryId,
      attributeValues: [value("motorhome", "body-type", "Hatchback")],
    });
    const { updateListing } = await import("@/actions/listings");

    const result = await updateListing({
      id: listingId,
      categoryId: vanCategoryId,
      attributes: [{ attributeDefinitionId: "van_body-type", value: "Hatchback" }],
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        "attr-van_body-type": [expect.stringContaining("body type")],
      }),
    );
    expect(updateDraftRevisionMock).not.toHaveBeenCalled();
  });

  it("leaves another seller's listing unchanged", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "someone-else",
      categoryId: vanCategoryId,
      status: "DRAFT",
      trustDeclarationAcceptedAt: null,
      lifecycleRevision: 1,
    });
    const { updateListing } = await import("@/actions/listings");

    await expect(
      updateListing({
        id: listingId,
        categoryId: vanCategoryId,
        attributes: requiredVan,
      }),
    ).resolves.toEqual({ error: "Not authorized to edit this listing" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(updateDraftRevisionMock).not.toHaveBeenCalled();
  });

  it("loads retained values from the matching saved source only", async () => {
    const { loadRetainedAttributeValues } = await import("@/lib/listings/retained-attributes");
    getOpenRevisionMock.mockResolvedValue({
      categoryId: motorhomeCategoryId,
      attributeValues: [value("motorhome", "body-type", "Hatchback")],
    });

    await expect(
      loadRetainedAttributeValues({
        listingId,
        storedCategoryId: motorhomeCategoryId,
        nextCategoryId: motorhomeCategoryId,
        pendingRevision: true,
      }),
    ).resolves.toEqual([value("motorhome", "body-type", "Hatchback")]);

    await expect(
      loadRetainedAttributeValues({
        listingId,
        storedCategoryId: motorhomeCategoryId,
        nextCategoryId: vanCategoryId,
        pendingRevision: true,
      }),
    ).resolves.toEqual([]);
    expect(mockDb.listingAttributeValue.findMany).not.toHaveBeenCalled();

    getOpenRevisionMock.mockResolvedValue(null);
    mockDb.listingAttributeValue.findMany.mockResolvedValue([
      value("van", "body-type", "Luton"),
    ]);
    await expect(
      loadRetainedAttributeValues({
        listingId,
        storedCategoryId: vanCategoryId,
        nextCategoryId: vanCategoryId,
        pendingRevision: false,
      }),
    ).resolves.toEqual([value("van", "body-type", "Luton")]);
    expect(mockDb.listingAttributeValue.findMany).toHaveBeenCalledWith({
      where: { listingId },
      select: { attributeDefinitionId: true, value: true },
    });

    mockDb.listingAttributeValue.findMany.mockClear();
    await expect(
      loadRetainedAttributeValues({
        listingId,
        storedCategoryId: vanCategoryId,
        nextCategoryId: motorhomeCategoryId,
        pendingRevision: false,
      }),
    ).resolves.toEqual([]);
    expect(mockDb.listingAttributeValue.findMany).not.toHaveBeenCalled();
  });

  it("saves an admin clear and rejects a hidden capacity", async () => {
    const expectedUpdatedAt = "2026-10-08T12:00:00.000Z";
    const tailLift = value("van", "tail-lift", "No");
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      title: baseListing.title,
      description: baseListing.description,
      price: baseListing.price,
      categoryId: vanCategoryId,
      regionId,
      lifecycleRevision: 2,
      updatedAt: new Date(expectedUpdatedAt),
      attributeValues: [
        value("van", "tail-lift", "Yes"),
        value("van", "tail-lift-capacity-kg", "500"),
      ],
    });
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");
    const input = {
      listingId,
      title: baseListing.title,
      description: baseListing.description,
      price: baseListing.price,
      categoryId: vanCategoryId,
      regionId,
      expectedLifecycleRevision: 2,
      expectedUpdatedAt,
    };

    const cleared = await saveAdminListingEdit({
      ...input,
      attributes: [...requiredVan, tailLift],
    });
    expect(cleared).toEqual({
      data: {
        listingId,
        unchanged: false,
        lifecycleRevision: 4,
        updatedAt: "2026-10-08T12:00:00.000Z",
      },
    });
    expect(mockDb.listingAttributeValue.deleteMany).toHaveBeenCalledWith({ where: { listingId } });
    const saved = mockDb.listingAttributeValue.createMany.mock.calls[0][0].data as Array<{
      attributeDefinitionId: string;
      value: string;
    }>;
    expect(saved).toEqual(
      expect.arrayContaining([expect.objectContaining(tailLift)]),
    );
    expect(saved.map((row) => row.attributeDefinitionId)).not.toContain(
      "van_tail-lift-capacity-kg",
    );

    mockDb.listing.updateMany.mockClear();
    const rejected = await saveAdminListingEdit({
      ...input,
      attributes: [...requiredVan, tailLift, value("van", "tail-lift-capacity-kg", "500")],
    });
    expect(rejected.error).toEqual(
      expect.objectContaining({
        "attr-van_tail-lift-capacity-kg": [expect.stringContaining("Tail lift is Yes")],
      }),
    );
    expect(mockDb.listing.updateMany).not.toHaveBeenCalled();
  });
});
