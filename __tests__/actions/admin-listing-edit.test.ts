import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  logAdminAction: vi.fn(),
  reportHandledException: vi.fn(),
  queryRaw: vi.fn(),
  listingFindUnique: vi.fn(),
  revisionFindFirst: vi.fn(),
  categoryFindUnique: vi.fn(),
  regionFindUnique: vi.fn(),
  listingUpdateMany: vi.fn(),
  attrDeleteMany: vi.fn(),
  attrCreateMany: vi.fn(),
  listingFindUniqueOrThrow: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.logAdminAction }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException: mocks.reportHandledException }));
vi.mock("@/lib/listings/listing-ns-policy", () => ({
  validateListingAttributesWithServerPolicy: vi.fn(({ attributes }) => ({
    sanitizedAttributes: attributes,
    fieldErrors: {},
    configurationError: null,
  })),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.queryRaw,
      listing: {
        findUnique: mocks.listingFindUnique,
        updateMany: mocks.listingUpdateMany,
        findUniqueOrThrow: mocks.listingFindUniqueOrThrow,
      },
      listingRevision: { findFirst: mocks.revisionFindFirst },
      category: { findUnique: mocks.categoryFindUnique },
      region: { findUnique: mocks.regionFindUnique },
      listingAttributeValue: {
        deleteMany: mocks.attrDeleteMany,
        createMany: mocks.attrCreateMany,
      },
    }),
  },
}));

const expectedUpdatedAt = "2026-09-30T10:00:00.000Z";
const input = {
  listingId: "clh7h6lk80000qwertyuiopas",
  title: "Updated title",
  description: "A clear updated listing description",
  price: 25000,
  categoryId: "clh7h6lk80001qwertyuiopas",
  regionId: "clh7h6lk80002qwertyuiopas",
  expectedLifecycleRevision: 2,
  expectedUpdatedAt,
  attributes: [],
};

describe("admin listing detail editor action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    mocks.queryRaw.mockResolvedValue([{
      id: input.listingId,
      lifecycleRevision: 2,
      updatedAt: new Date(expectedUpdatedAt),
    }]);
    mocks.listingFindUnique.mockResolvedValue({
      id: input.listingId,
      title: "Old title",
      description: "A clear listing description long enough",
      price: 25000,
      categoryId: "category-1",
      regionId: "region-1",
      lifecycleRevision: 2,
      updatedAt: new Date(expectedUpdatedAt),
      attributeValues: [],
    });
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.categoryFindUnique.mockResolvedValue({
      id: input.categoryId,
      slug: "cars",
      active: true,
      attributeDefinitions: [],
    });
    mocks.regionFindUnique.mockResolvedValue({ id: input.regionId, active: true });
    mocks.listingUpdateMany.mockResolvedValue({ count: 1 });
    mocks.attrDeleteMany.mockResolvedValue({ count: 0 });
    mocks.listingFindUniqueOrThrow.mockResolvedValue({
      lifecycleRevision: 3,
      updatedAt: new Date("2026-09-30T10:01:00.000Z"),
    });
  });

  it("requires ADMIN and checks the locked revision before editing", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");
    mocks.queryRaw.mockResolvedValueOnce([{
      id: input.listingId,
      lifecycleRevision: 3,
      updatedAt: new Date(expectedUpdatedAt),
    }]);

    const result = await saveAdminListingEdit(input);

    expect(mocks.requireRole).toHaveBeenCalledWith("ADMIN");
    expect(result).toMatchObject({ conflict: true });
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("blocks edits while a seller revision is open", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");
    mocks.revisionFindFirst.mockResolvedValueOnce({ id: "revision-1" });

    const result = await saveAdminListingEdit(input);

    expect(result).toMatchObject({ conflict: true });
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("saves only allowlisted details and writes an audit in the transaction", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");

    const result = await saveAdminListingEdit(input);

    expect(result).toMatchObject({ data: { unchanged: false, lifecycleRevision: 3 } });
    expect(mocks.listingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Updated title",
        description: "A clear updated listing description",
        price: 25000,
        categoryId: input.categoryId,
        regionId: input.regionId,
        lifecycleRevision: { increment: 1 },
      }),
    }));
    expect(mocks.listingUpdateMany.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(mocks.listingUpdateMany.mock.calls[0][0].data).not.toHaveProperty("ownerId");
    expect(mocks.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "ADMIN_EDIT_LISTING_DETAILS",
      entityType: "Listing",
      entityId: input.listingId,
    }), expect.anything());
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/listings/${input.listingId}`);
  });

  it("rejects unexpected status/payment fields", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");

    const result = await saveAdminListingEdit({ ...input, status: "SOLD" });

    expect(result).toHaveProperty("error");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-admin before reading or changing listing data", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");
    mocks.requireRole.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(saveAdminListingEdit(input)).rejects.toThrow("Forbidden");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.listingFindUnique).not.toHaveBeenCalled();
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an intervening edit even when the lifecycle revision is unchanged", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");
    mocks.queryRaw.mockResolvedValueOnce([{
      id: input.listingId,
      lifecycleRevision: input.expectedLifecycleRevision,
      updatedAt: new Date("2026-09-30T10:00:01.000Z"),
    }]);

    expect(await saveAdminListingEdit(input)).toMatchObject({ conflict: true });
    expect(mocks.attrDeleteMany).not.toHaveBeenCalled();
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("does not delete existing attributes when an unrelated category attribute is supplied", async () => {
    const { saveAdminListingEdit } = await import("@/actions/admin/listing-edit");

    expect(await saveAdminListingEdit({
      ...input,
      attributes: [{ attributeDefinitionId: "another-category-field", value: "value" }],
    })).toMatchObject({ error: "One or more attributes do not belong to this category." });
    expect(mocks.attrDeleteMany).not.toHaveBeenCalled();
    expect(mocks.listingUpdateMany).not.toHaveBeenCalled();
  });
});
