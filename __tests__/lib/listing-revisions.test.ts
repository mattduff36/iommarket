import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  dispatchMock,
  applyImagesMock,
  cleanupMock,
  cloneMock,
} = vi.hoisted(() => ({
  mockDb: {
    listing: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    listingRevision: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    listingAttributeValue: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    listingRevisionAttributeValue: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    listingStatusEvent: {
      create: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  dispatchMock: vi.fn(),
  applyImagesMock: vi.fn(),
  cleanupMock: vi.fn(),
  cloneMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications: dispatchMock,
}));
vi.mock("@/lib/listings/revision-photos", () => ({
  applyRevisionImages: applyImagesMock,
  cleanupRejectedRevisionOnlyImages: cleanupMock,
  cloneLiveImagesToRevision: cloneMock,
}));

import {
  approveRevision,
  getOrCreateDraftRevision,
  rejectRevision,
  submitRevision,
  updateDraftRevision,
} from "@/lib/listings/revisions";
import { isListingPubliclyVisible } from "@/lib/listings/visibility";

describe("listing revisions ALR-REV-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb),
    );
    mockDb.listingRevision.findFirst.mockResolvedValue(null);
    mockDb.listing.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listingStatusEvent.create.mockResolvedValue({ id: "event-1" });
    mockDb.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 2,
    });
    mockDb.listingRevisionAttributeValue.findFirst.mockResolvedValue(null);
  });

  it("creates a draft revision while the live listing stays public ALR-REV-001", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      title: "Live van",
      description: "A van",
      price: 100000,
      categoryId: "cat-1",
      regionId: "reg-1",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 0,
      attributeValues: [],
    });
    mockDb.listingRevision.create.mockResolvedValue({
      id: "rev-1",
      listingId: "listing-1",
      status: "DRAFT",
      images: [],
      attributeValues: [],
    });
    mockDb.listingRevision.findUniqueOrThrow.mockResolvedValue({
      id: "rev-1",
      listingId: "listing-1",
      status: "DRAFT",
      title: "Live van",
      images: [],
      attributeValues: [],
    });

    const revision = await getOrCreateDraftRevision({
      listingId: "listing-1",
      userId: "user-1",
    });

    expect(revision.status).toBe("DRAFT");
    expect(cloneMock).toHaveBeenCalled();
    expect(mockDb.listing.updateMany).toHaveBeenCalledWith({
      where: { id: "listing-1", lifecycleRevision: 0 },
      data: { lifecycleRevision: { increment: 1 } },
    });
    expect(mockDb.listing.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.listingRevision.create.mock.invocationCallOrder[0],
    );
    expect(
      isListingPubliclyVisible({
        status: "LIVE",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe(true);
  });

  it("submits a revision without changing listing status ALR-REV-002", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      lifecycleRevision: 1,
      expiresAt: new Date(Date.now() + 60_000),
      images: [{ id: "img-1" }, { id: "img-2" }],
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      status: "DRAFT",
      version: 2,
      trustDeclarationAccepted: true,
      images: [{ id: "img-1" }, { id: "img-2" }],
    });
    mockDb.listingRevision.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listing.updateMany.mockResolvedValue({ count: 1 });

    const result = await submitRevision({
      listingId: "listing-1",
      userId: "user-1",
      expectedListingRevision: 1,
      expectedVersion: 2,
    });

    expect(result.listing.status).toBe("LIVE");
    expect(result.notification.action).toBe("SUBMIT_REVISION");
    expect(mockDb.listingRevision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "DRAFT", version: 2 }),
      }),
    );
    expect(dispatchMock).toHaveBeenCalled();
  });

  it("approves a revision without resetting expiry ALR-REV-003 ALR-RESUB-002", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt,
      lifecycleRevision: 3,
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      version: 4,
      title: "Updated",
      description: "Updated body",
      price: 200000,
      categoryId: "cat-1",
      regionId: "reg-1",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
    });
    mockDb.listing.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listingRevision.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listingRevisionAttributeValue.findMany.mockResolvedValue([]);
    mockDb.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt,
      lifecycleRevision: 4,
    });

    const result = await approveRevision({
      listingId: "listing-1",
      adminId: "admin-1",
      expectedListingRevision: 3,
      expectedVersion: 4,
    });

    expect(result.listing.status).toBe("LIVE");
    expect(result.listing.expiresAt).toEqual(expiresAt);
    expect(applyImagesMock).toHaveBeenCalled();
    expect(mockDb.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ expiresAt: expect.anything() }),
      }),
    );
  });

  it("rejects a revision without mutating live content ALR-REV-004", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      lifecycleRevision: 3,
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({ id: "rev-1", version: 4 });
    mockDb.listingRevision.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listing.updateMany.mockResolvedValue({ count: 1 });

    const result = await rejectRevision({
      listingId: "listing-1",
      adminId: "admin-1",
      expectedListingRevision: 3,
      expectedVersion: 4,
      reasonCode: "MISLEADING",
    });

    expect(result.listing.status).toBe("LIVE");
    expect(cleanupMock).toHaveBeenCalled();
    expect(mockDb.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lifecycleRevision: { increment: 1 } },
      }),
    );
  });

  it("enforces owner and CAS rules ALR-REV-007", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "other-user",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      attributeValues: [],
    });

    await expect(
      getOrCreateDraftRevision({ listingId: "listing-1", userId: "user-1" }),
    ).rejects.toThrow("Not authorized");
  });

  it("does not leave a draft when a lifecycle transition wins creation LST-CAS-001", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 4,
      attributeValues: [],
    });
    mockDb.listingRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockDb.listing.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      getOrCreateDraftRevision({ listingId: "listing-1", userId: "user-1" }),
    ).rejects.toThrow("Listing revision changed");
    expect(mockDb.listingRevision.create).not.toHaveBeenCalled();
  });

  it("returns the concurrent draft winner after a unique-index race LST-CAS-001", async () => {
    const winner = {
      id: "rev-winner",
      listingId: "listing-1",
      status: "DRAFT",
      images: [],
      attributeValues: [],
    };
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 4,
      attributeValues: [],
    });
    mockDb.listingRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    mockDb.listingRevision.create.mockRejectedValueOnce(new Error("unique conflict"));

    await expect(
      getOrCreateDraftRevision({ listingId: "listing-1", userId: "user-1" }),
    ).resolves.toEqual(winner);
  });

  it("rejects a stale approval race ALR-REV-006", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 4,
    });

    await expect(
      approveRevision({
        listingId: "listing-1",
        adminId: "admin-1",
        expectedListingRevision: 3,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("Listing revision changed");
    expect(applyImagesMock).not.toHaveBeenCalled();
    expect(mockDb.listing.updateMany).not.toHaveBeenCalled();
  });

  it("allows no partial approval when the lifecycle CAS loses LST-CAS-002", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 3,
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      version: 4,
      title: "Updated",
      description: "Updated body",
      price: 200000,
      categoryId: "cat-1",
      regionId: "reg-1",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
    });
    mockDb.listing.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      approveRevision({
        listingId: "listing-1",
        adminId: "admin-1",
        expectedListingRevision: 3,
        expectedVersion: 4,
      }),
    ).rejects.toThrow("Listing revision changed");
    expect(mockDb.listingAttributeValue.deleteMany).not.toHaveBeenCalled();
    expect(applyImagesMock).not.toHaveBeenCalled();
    expect(mockDb.listingRevision.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale revision-version race ALR-REV-006", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      status: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
      lifecycleRevision: 3,
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      version: 5,
    });

    await expect(
      approveRevision({
        listingId: "listing-1",
        adminId: "admin-1",
        expectedListingRevision: 3,
        expectedVersion: 4,
      }),
    ).rejects.toThrow("Listing revision changed");
    expect(applyImagesMock).not.toHaveBeenCalled();
    expect(mockDb.listing.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back text and attribute writes when moderation wins LST-CAS-002", async () => {
    let rolledBack = false;
    mockDb.$transaction.mockImplementationOnce(
      async (callback: (tx: typeof mockDb) => Promise<unknown>) => {
        try {
          return await callback(mockDb);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    );
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      status: "DRAFT",
      version: 2,
      trustDeclarationAcceptedAt: new Date(),
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      lifecycleRevision: 5,
      trustDeclarationAcceptedAt: new Date(),
    });
    mockDb.listingRevision.updateMany.mockResolvedValue({ count: 1 });
    mockDb.listing.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateDraftRevision({
        listingId: "listing-1",
        userId: "user-1",
        expectedVersion: 2,
        expectedListingRevision: 5,
        data: { title: "Racing update" },
        attributes: [
          { attributeDefinitionId: "attr-1", value: "updated" },
        ],
      }),
    ).rejects.toThrow("Listing revision changed");
    expect(mockDb.listingRevisionAttributeValue.deleteMany).toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it("dispatches revision mail only after commit and isolates mail failure MAIL-TXN-001", async () => {
    let releaseCommit: (() => void) | undefined;
    const commitBarrier = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    mockDb.$transaction.mockImplementationOnce(
      async (callback: (tx: typeof mockDb) => Promise<unknown>) => {
        const result = await callback(mockDb);
        await commitBarrier;
        return result;
      },
    );
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      lifecycleRevision: 1,
      expiresAt: new Date(Date.now() + 60_000),
      images: [],
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      status: "DRAFT",
      version: 2,
      trustDeclarationAccepted: true,
      images: [{ id: "img-1" }, { id: "img-2" }],
    });
    mockDb.listingRevision.updateMany.mockResolvedValue({ count: 1 });
    dispatchMock.mockRejectedValueOnce(new Error("mail unavailable"));

    const pending = submitRevision({
      listingId: "listing-1",
      userId: "user-1",
      expectedListingRevision: 1,
      expectedVersion: 2,
    });
    await vi.waitFor(() => expect(mockDb.listing.findUniqueOrThrow).toHaveBeenCalled());
    expect(dispatchMock).not.toHaveBeenCalled();

    releaseCommit?.();
    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        notification: expect.objectContaining({ action: "SUBMIT_REVISION" }),
      }),
    );
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a live revision submit without a write-off declaration POL-LIST-001", async () => {
    const previous = process.env.POLICY_ENFORCE_LISTING_NS;
    process.env.POLICY_ENFORCE_LISTING_NS = "true";
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      userId: "user-1",
      status: "LIVE",
      lifecycleRevision: 1,
      expiresAt: new Date(Date.now() + 60_000),
      images: [{ id: "img-1" }, { id: "img-2" }],
    });
    mockDb.listingRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      status: "DRAFT",
      version: 2,
      trustDeclarationAccepted: true,
      images: [{ id: "img-1" }, { id: "img-2" }],
    });
    mockDb.listingRevisionAttributeValue.findFirst.mockResolvedValue(null);

    try {
      await expect(
        submitRevision({
          listingId: "listing-1",
          userId: "user-1",
          expectedListingRevision: 1,
          expectedVersion: 2,
        }),
      ).rejects.toThrow(
        "Choose None, Category N, or Category S before submitting this listing.",
      );
      expect(mockDb.listingRevision.updateMany).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.POLICY_ENFORCE_LISTING_NS;
      } else {
        process.env.POLICY_ENFORCE_LISTING_NS = previous;
      }
    }
  });
});
