import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  claimFreeListingSlotMock,
  transitionListingStatusMock,
  getOpenRevisionMock,
  submitRevisionMock,
  captureExceptionMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  claimFreeListingSlotMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  getOpenRevisionMock: vi.fn(),
  submitRevisionMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  mockDb: {
    listing: {
      findUnique: vi.fn(),
    },
    listingAttributeValue: {
      findFirst: vi.fn(),
    },
    listingRevisionAttributeValue: {
      findFirst: vi.fn(),
    },
    policyAcceptance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAuthMock,
}));

vi.mock("@/lib/config/marketplace", () => ({
  claimFreeListingSlot: claimFreeListingSlotMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/listings/revisions", () => ({
  getOpenRevision: getOpenRevisionMock,
  getOrCreateDraftRevision: vi.fn(),
  submitRevision: submitRevisionMock,
  updateDraftRevision: vi.fn(),
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
      lifecycleRevision: 0,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
    });
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.listingAttributeValue.findFirst.mockResolvedValue(null);
    mockDb.listingRevisionAttributeValue.findFirst.mockResolvedValue(null);
    mockDb.policyAcceptance.upsert.mockResolvedValue({ id: "acc_1" });
    claimFreeListingSlotMock.mockResolvedValue({ status: "already-claimed" });
  });

  it("rejects a private submission without explicit or prior acceptance MD-SELL-001", async () => {
    const { submitListingForReview } = await import("@/actions/listings");
    const previous = process.env.POLICY_ENFORCE_ACCEPTANCE;
    process.env.POLICY_ENFORCE_ACCEPTANCE = "true";
    mockDb.policyAcceptance.findUnique.mockResolvedValue(null);

    try {
      await expect(submitListingForReview("listing_123")).resolves.toEqual({
        error:
          "You must accept the Private Seller Terms before submitting this listing.",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.POLICY_ENFORCE_ACCEPTANCE;
      } else {
        process.env.POLICY_ENFORCE_ACCEPTANCE = previous;
      }
    }

    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
  });

  it("returns a safe error when enforced receipt verification fails", async () => {
    const { submitListingForReview } = await import("@/actions/listings");
    const previous = process.env.POLICY_ENFORCE_ACCEPTANCE;
    process.env.POLICY_ENFORCE_ACCEPTANCE = "true";
    mockDb.policyAcceptance.findUnique.mockRejectedValue(
      new Error("database unavailable"),
    );

    try {
      await expect(submitListingForReview("listing_123")).resolves.toEqual({
        error:
          "Unable to verify Private Seller Terms acceptance. Please try again.",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.POLICY_ENFORCE_ACCEPTANCE;
      } else {
        process.env.POLICY_ENFORCE_ACCEPTANCE = previous;
      }
    }

    expect(captureExceptionMock).toHaveBeenCalled();
    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
  });

  it("keeps legacy submissions behind the acceptance rollout switch without manufacturing receipts", async () => {
    const { submitListingForReview } = await import("@/actions/listings");
    const previous = process.env.POLICY_ENFORCE_ACCEPTANCE;
    delete process.env.POLICY_ENFORCE_ACCEPTANCE;

    try {
      await expect(submitListingForReview("listing_123")).resolves.toEqual({
        error:
          "Your one free listing has already been used. Complete payment for this listing to submit it.",
      });
    } finally {
      if (previous !== undefined) {
        process.env.POLICY_ENFORCE_ACCEPTANCE = previous;
      }
    }

    expect(mockDb.policyAcceptance.findUnique).not.toHaveBeenCalled();
    expect(mockDb.policyAcceptance.upsert).not.toHaveBeenCalled();
    expect(claimFreeListingSlotMock).toHaveBeenCalled();
  });

  it("records explicit acceptance idempotently for new and revision submissions MD-SELL-002", async () => {
    const { submitListingForReview } = await import("@/actions/listings");

    await submitListingForReview({
      listingId: "listing_123",
      privateSellerTermsAccepted: true,
    });
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: expect.objectContaining({
          userId: "user_123",
          acceptanceType: "LISTING_BUNDLE",
          source: "LISTING",
        }),
      }),
    );

    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: null,
      status: "LIVE",
      lifecycleRevision: 4,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
    });
    getOpenRevisionMock.mockResolvedValue({
      id: "revision_1",
      status: "DRAFT",
      version: 2,
    });
    submitRevisionMock.mockResolvedValue({
      listing: { id: "listing_123", status: "LIVE" },
    });

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { id: "listing_123", status: "LIVE" },
    });
    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledTimes(2);
    expect(submitRevisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "listing_123",
        expectedListingRevision: 4,
        expectedVersion: 2,
      }),
    );
  });

  it("requires payment to renew a free listing", async () => {
    const { submitListingForReview } = await import("@/actions/listings");
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      lifecycleRevision: 0,
      expiresAt: new Date("2025-01-01T00:00:00Z"),
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
    });
    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({ error: "Payment is required to renew an expired listing." });

    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
  });

  it("rejects submit without a write-off declaration when enforcement is on POL-LIST-001", async () => {
    const previous = process.env.POLICY_ENFORCE_LISTING_NS;
    process.env.POLICY_ENFORCE_LISTING_NS = "true";
    mockDb.listingAttributeValue.findFirst.mockResolvedValue(null);

    try {
      const { submitListingForReview } = await import("@/actions/listings");
      await expect(submitListingForReview("listing_123")).resolves.toEqual({
        error:
          "Choose None, Category N, or Category S before submitting this listing.",
      });
      expect(transitionListingStatusMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.POLICY_ENFORCE_LISTING_NS;
      } else {
        process.env.POLICY_ENFORCE_LISTING_NS = previous;
      }
    }
  });
});
