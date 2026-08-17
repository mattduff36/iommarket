import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  claimFreeListingSlotMock,
  transitionListingStatusMock,
  getOpenRevisionMock,
  submitRevisionMock,
  syncListingImagesForUserMock,
  expireAbandonedListingImageIntentsMock,
  processListingImageCleanupJobsMock,
  captureBusinessEventMock,
  captureExceptionMock,
  reportHandledExceptionMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  dispatchListingNotificationsMock,
  mockDb,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  claimFreeListingSlotMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  getOpenRevisionMock: vi.fn(),
  submitRevisionMock: vi.fn(),
  syncListingImagesForUserMock: vi.fn(),
  expireAbandonedListingImageIntentsMock: vi.fn(),
  processListingImageCleanupJobsMock: vi.fn(),
  captureBusinessEventMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  reportHandledExceptionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  dispatchListingNotificationsMock: vi.fn(),
  mockDb: {
    listing: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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
    subscription: {
      findFirst: vi.fn(),
    },
    freeListingClaim: {
      findUnique: vi.fn(),
    },
  },
  revalidatePathMock: vi.fn(),
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
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/cache.js", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/dist/server/web/spec-extension/revalidate", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/dist/server/web/spec-extension/revalidate.js", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/listings/status-events", () => ({
  ListingLifecycleError: class ListingLifecycleError extends Error {},
  transitionListingStatus: transitionListingStatusMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: captureBusinessEventMock,
  captureException: captureExceptionMock,
  reportHandledException: reportHandledExceptionMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: makeRateLimitKeyMock,
}));

vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications: dispatchListingNotificationsMock,
}));

vi.mock("@/lib/listings/revisions", () => ({
  getOpenRevision: getOpenRevisionMock,
  getOrCreateDraftRevision: vi.fn(),
  submitRevision: submitRevisionMock,
  updateDraftRevision: vi.fn(),
}));

vi.mock("@/lib/listings/photo-mutation", () => ({
  syncListingImagesForUser: syncListingImagesForUserMock,
}));

vi.mock("@/lib/listings/photo-cleanup", () => ({
  expireAbandonedListingImageIntents: expireAbandonedListingImageIntentsMock,
  processListingImageCleanupJobs: processListingImageCleanupJobsMock,
}));

describe("submitListingForReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
    });
    checkRateLimitMock.mockReturnValue({ allowed: true });
    makeRateLimitKeyMock.mockImplementation(
      (scope: string, identifier: string) => `${scope}:${identifier}`,
    );
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: null,
      status: "DRAFT",
      lifecycleRevision: 0,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
      category: {
        slug: "car",
        attributeDefinitions: [
          {
            id: "write-off",
            slug: "write-off-category",
            name: "Insurance write-off category",
            dataType: "select",
            required: false,
            options: JSON.stringify(["None", "Category N", "Category S"]),
          },
        ],
      },
    });
    mockDb.payment.findFirst.mockResolvedValue(null);
    mockDb.subscription.findFirst.mockResolvedValue(null);
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);
    mockDb.listingAttributeValue.findFirst.mockResolvedValue({ value: "None" });
    mockDb.listingRevisionAttributeValue.findFirst.mockResolvedValue({
      value: "None",
    });
    delete process.env.POLICY_ENFORCE_LISTING_NS;
    mockDb.policyAcceptance.upsert.mockResolvedValue({ id: "acc_1" });
    claimFreeListingSlotMock.mockResolvedValue({ status: "already-claimed" });
    mockDb.listing.update.mockResolvedValue({ id: "listing_123", dealerId: null });
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
    );
  });

  it("rate-limits submit and resubmit before transition or email", async () => {
    checkRateLimitMock
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ allowed: false });
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "Too many listing status changes. Please wait a few minutes and try again.",
    });

    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "listing-lifecycle-user",
      "user_123",
    );
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "listing-lifecycle-user:user_123",
      { windowMs: 600_000, maxRequests: 12 },
    );
    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "listing-lifecycle",
      "user_123:listing_123",
    );
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "listing-lifecycle:user_123:listing_123",
      { windowMs: 600_000, maxRequests: 6 },
    );
    expect(mockDb.listing.findUnique).not.toHaveBeenCalled();
    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(dispatchListingNotificationsMock).not.toHaveBeenCalled();
  });

  it("bounds multi-listing churn before creating attacker-controlled keys", async () => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: false });
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "attacker-controlled-listing-key",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "Too many listing status changes. Please wait a few minutes and try again.",
    });

    expect(makeRateLimitKeyMock).toHaveBeenCalledTimes(1);
    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "listing-lifecycle-user",
      "user_123",
    );
    expect(mockDb.listing.findUnique).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(dispatchListingNotificationsMock).not.toHaveBeenCalled();
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

  it("resubmits a withdrawn free-claim draft without a second claim MD-LIFE-003", async () => {
    mockDb.freeListingClaim.findUnique.mockResolvedValue({
      id: "claim_1",
      userId: "user_123",
    });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: "listing_123", status: "PENDING" },
      notification: null,
    });

    const { submitListingForReview } = await import("@/actions/listings");
    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { id: "listing_123", status: "PENDING" },
    });

    expect(claimFreeListingSlotMock).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SUBMIT",
        expectedRevision: 0,
      }),
    );
  });

  it("returns safe conflict copy for a plain submit CAS race", async () => {
    const { ListingLifecycleConflictError } = await import(
      "@/lib/listings/errors"
    );
    mockDb.freeListingClaim.findUnique.mockResolvedValue({
      id: "claim_1",
      userId: "user_123",
    });
    transitionListingStatusMock.mockRejectedValue(
      new ListingLifecycleConflictError(),
    );
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "This listing changed before it could be submitted. Refresh and try again.",
      conflict: true,
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("returns safe conflict copy for a free-claim submit race", async () => {
    const { ListingLifecycleConflictError } = await import(
      "@/lib/listings/errors"
    );
    claimFreeListingSlotMock.mockRejectedValue(
      new ListingLifecycleConflictError(),
    );
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "This listing changed before it could be submitted. Refresh and try again.",
      conflict: true,
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("preserves safe actionable free-claim lifecycle errors", async () => {
    const { ListingLifecycleError } = await import("@/lib/listings/errors");
    claimFreeListingSlotMock.mockRejectedValue(
      new ListingLifecycleError(
        "Payment is required to renew an expired listing.",
      ),
    );
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error: "Payment is required to renew an expired listing.",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["plain", true],
    ["free-claim", false],
  ] as const)(
    "reports unexpected %s submit failures with fixed safe copy",
    async (_flow, hasPriorClaim) => {
      mockDb.freeListingClaim.findUnique.mockResolvedValue(
        hasPriorClaim ? { id: "claim_1", userId: "user_123" } : null,
      );
      if (hasPriorClaim) {
        transitionListingStatusMock.mockRejectedValue(
          new Error("internal database details"),
        );
      } else {
        claimFreeListingSlotMock.mockRejectedValue(
          new Error("internal database details"),
        );
      }
      const { submitListingForReview } = await import("@/actions/listings");

      await expect(
        submitListingForReview({
          listingId: "listing_123",
          privateSellerTermsAccepted: true,
        }),
      ).resolves.toEqual({
        error: "Unable to submit this listing. Please try again.",
      });
      expect(reportHandledExceptionMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "submitListingForReview" }),
      );
      expect(captureExceptionMock).not.toHaveBeenCalled();
    },
  );

  it("returns safe conflict copy for revision submission races", async () => {
    const { ListingRevisionConflictError } = await import(
      "@/lib/listings/errors"
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
    submitRevisionMock.mockRejectedValue(new ListingRevisionConflictError());
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "These listing changes changed before they could be submitted. Refresh and try again.",
      conflict: true,
    });
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
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

  it("AUD-LIFE-001a treats a demoted seller's paid-period draft as private", async () => {
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: "dealer-1",
      status: "DRAFT",
      lifecycleRevision: 0,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
      dealer: { tier: "STARTER" },
    });
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-paid",
      source: "PAYMENT",
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
    });
    mockDb.freeListingClaim.findUnique.mockResolvedValue({
      id: "claim_1",
      userId: "user_123",
    });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: "listing_123", status: "PENDING", dealerId: null },
      notification: null,
    });

    const { submitListingForReview } = await import("@/actions/listings");
    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { id: "listing_123", status: "PENDING", dealerId: null },
    });

    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptanceType: "LISTING_BUNDLE",
        }),
      }),
    );
    expect(mockDb.listing.update).toHaveBeenCalledWith({
      where: { id: "listing_123" },
      data: { dealerId: null },
    });
    expect(transitionListingStatusMock).toHaveBeenCalled();
  });

  it("AUD-LIFE-001a treats a demoted seller's live revision as private", async () => {
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: "dealer-1",
      status: "LIVE",
      lifecycleRevision: 4,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
      dealer: { tier: "STARTER" },
    });
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-paid",
      source: "PAYMENT",
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
    });
    getOpenRevisionMock.mockResolvedValue({
      id: "revision_1",
      status: "DRAFT",
      version: 2,
    });
    submitRevisionMock.mockResolvedValue({
      listing: { id: "listing_123", status: "LIVE" },
    });

    const { submitListingForReview } = await import("@/actions/listings");
    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      data: { id: "listing_123", status: "LIVE" },
    });

    expect(mockDb.policyAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptanceType: "LISTING_BUNDLE",
        }),
      }),
    );
    expect(mockDb.listing.update).not.toHaveBeenCalled();
    expect(submitRevisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "listing_123",
        userId: "user_123",
        expectedListingRevision: 4,
        expectedVersion: 2,
        seller: expect.objectContaining({
          role: "USER",
          dealerProfile: { id: "dealer-1", tier: "STARTER" },
        }),
      }),
    );
  });

  it("does not detach a stale dealerId before submitRevision on conflict", async () => {
    const { ListingRevisionConflictError } = await import(
      "@/lib/listings/errors"
    );
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      userId: "user_123",
      dealerId: "dealer-1",
      status: "LIVE",
      lifecycleRevision: 4,
      trustDeclarationAccepted: true,
      images: [{ id: "image_1" }, { id: "image_2" }],
      dealer: { tier: "STARTER" },
    });
    getOpenRevisionMock.mockResolvedValue({
      id: "revision_1",
      status: "DRAFT",
      version: 2,
    });
    submitRevisionMock.mockRejectedValue(new ListingRevisionConflictError());
    const { submitListingForReview } = await import("@/actions/listings");

    await expect(
      submitListingForReview({
        listingId: "listing_123",
        privateSellerTermsAccepted: true,
      }),
    ).resolves.toEqual({
      error:
        "These listing changes changed before they could be submitted. Refresh and try again.",
      conflict: true,
    });
    expect(mockDb.listing.update).not.toHaveBeenCalled();
    expect(submitRevisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        seller: expect.objectContaining({ role: "USER" }),
      }),
    );
  });

  it("AUD-PAY-POL-001 LST-WRITEOFF-001 rejects submit without a write-off declaration when enforcement is on POL-LIST-001", async () => {
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

describe("withdrawListingSubmission", () => {
  const listingId = "caaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
    });
    checkRateLimitMock.mockReturnValue({ allowed: true });
    makeRateLimitKeyMock.mockImplementation(
      (scope: string, identifier: string) => `${scope}:${identifier}`,
    );
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      status: "PENDING",
      lifecycleRevision: 5,
    });
  });

  it("uses the lifecycle path with the caller's expected revision MD-LIFE-001", async () => {
    transitionListingStatusMock.mockResolvedValue({
      listing: {
        id: listingId,
        status: "DRAFT",
        lifecycleRevision: 6,
        featured: true,
      },
      notification: null,
    });
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({
        listingId,
        expectedRevision: 5,
      }),
    ).resolves.toEqual({
      data: expect.objectContaining({
        status: "DRAFT",
        featured: true,
      }),
    });
    expect(transitionListingStatusMock).toHaveBeenCalledWith({
      listingId,
      action: "WITHDRAW",
      expectedRevision: 5,
      actor: { id: "user_123", role: "USER" },
      source: "USER",
      notes: "Submission withdrawn by seller",
    });
  });

  it("rejects malformed input before lookup, limiting, or transition", async () => {
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({
        listingId: "not-a-cuid",
        expectedRevision: 5,
      }),
    ).resolves.toEqual({ error: "Invalid withdrawal request." });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(mockDb.listing.findUnique).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    [
      "non-owner",
      {
        id: listingId,
        userId: "another-user",
        status: "PENDING",
        lifecycleRevision: 5,
      },
    ],
  ])("returns the same safe response for a %s listing", async (_label, found) => {
    mockDb.listing.findUnique.mockResolvedValue(found);
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({ listingId, expectedRevision: 5 }),
    ).resolves.toEqual({ error: "Submission not found." });
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("rejects a listing that is no longer pending", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      status: "DRAFT",
      lifecycleRevision: 6,
    });
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({ listingId, expectedRevision: 5 }),
    ).resolves.toEqual({
      error: "Only submissions awaiting review can be withdrawn.",
      conflict: true,
    });
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("rate-limits withdrawal before lookup, transition, or email", async () => {
    checkRateLimitMock
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ allowed: false });
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({ listingId, expectedRevision: 5 }),
    ).resolves.toEqual({
      error:
        "Too many listing status changes. Please wait a few minutes and try again.",
    });
    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "listing-lifecycle-user",
      "user_123",
    );
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "listing-lifecycle-user:user_123",
      { windowMs: 600_000, maxRequests: 12 },
    );
    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "listing-lifecycle",
      `user_123:${listingId}`,
    );
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      `listing-lifecycle:user_123:${listingId}`,
      { windowMs: 600_000, maxRequests: 6 },
    );
    expect(mockDb.listing.findUnique).not.toHaveBeenCalled();
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(dispatchListingNotificationsMock).not.toHaveBeenCalled();
  });

  it("maps dealer sellers without granting admin semantics", async () => {
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "dealer@example.com",
      role: "DEALER",
    });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: listingId, status: "DRAFT" },
      notification: null,
    });
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await withdrawListingSubmission({ listingId, expectedRevision: 5 });

    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: "user_123", role: "DEALER" },
        source: "USER",
      }),
    );
  });

  it("returns a recoverable pre-check revision conflict without monitoring", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      userId: "user_123",
      status: "PENDING",
      lifecycleRevision: 6,
    });
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({ listingId, expectedRevision: 5 }),
    ).resolves.toEqual({
      error:
        "This submission changed before it could be withdrawn. Refresh and try again.",
      conflict: true,
    });
    expect(transitionListingStatusMock).not.toHaveBeenCalled();
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("returns a recoverable stale-conflict response", async () => {
    const { ListingLifecycleConflictError } = await import(
      "@/lib/listings/errors"
    );
    transitionListingStatusMock.mockRejectedValue(
      new ListingLifecycleConflictError(),
    );
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({
        listingId,
        expectedRevision: 5,
      }),
    ).resolves.toEqual({
      error:
        "This submission changed before it could be withdrawn. Refresh and try again.",
      conflict: true,
    });
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("reports unexpected failures while returning fixed safe copy", async () => {
    transitionListingStatusMock.mockRejectedValue(new Error("database failed"));
    const { withdrawListingSubmission } = await import("@/actions/listings");

    await expect(
      withdrawListingSubmission({ listingId, expectedRevision: 5 }),
    ).resolves.toEqual({
      error: "Unable to withdraw this submission. Please try again.",
    });
    expect(reportHandledExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "withdrawListingSubmission",
        userId: "user_123",
      }),
    );
  });
});

describe("syncListingImages action validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "user_123",
      email: "seller@example.com",
      role: "USER",
    });
    syncListingImagesForUserMock.mockResolvedValue({
      data: { count: 1, photoRevision: 2 },
    });
  });

  it.each([
    ["", { photos: [], basePhotoRevision: 0, mutationId: "mutation-1" }],
    ["listing-1", { photos: [], basePhotoRevision: -1, mutationId: "mutation-1" }],
    ["listing-1", { photos: [], basePhotoRevision: 0, mutationId: " " }],
    [
      "listing-1",
      {
        photos: [{ focalX: 0.5, focalY: 0.5 }],
        basePhotoRevision: 0,
        mutationId: "mutation-1",
      },
    ],
    [
      "listing-1",
      {
        photos: [{ imageId: "image-1", uploadIntentId: "intent-1" }],
        basePhotoRevision: 0,
        mutationId: "mutation-1",
      },
    ],
    [
      "listing-1",
      {
        photos: [{ imageId: "image-1", focalX: 0.5 }],
        basePhotoRevision: 0,
        mutationId: "mutation-1",
      },
    ],
    [
      "listing-1",
      {
        photos: [{ imageId: "image-1", focalX: 1.1, focalY: 0.5 }],
        basePhotoRevision: 0,
        mutationId: "mutation-1",
      },
    ],
  ])("rejects malformed photo synchronization input", async (listingId, input) => {
    const { syncListingImages } = await import("@/actions/listings");

    await expect(syncListingImages(listingId, input as never)).resolves.toEqual({
      error: "Invalid photo update.",
    });
    expect(syncListingImagesForUserMock).not.toHaveBeenCalled();
    expect(captureBusinessEventMock).not.toHaveBeenCalled();
  });

  it("reports unexpected client schema drift without capturing an exception", async () => {
    const { syncListingImages } = await import("@/actions/listings");

    await expect(
      syncListingImages(
        "listing-1",
        {
          photos: [],
          basePhotoRevision: 0,
          mutationId: "mutation-1",
          unexpected: true,
        } as never,
      ),
    ).resolves.toEqual({ error: "Invalid photo update." });

    expect(captureBusinessEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "LOW",
        title: "Listing photo client contract drift",
        action: "syncListingImages",
      }),
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(syncListingImagesForUserMock).not.toHaveBeenCalled();
  });

  it("forwards validated photo input without weakening the mutation contract", async () => {
    const { syncListingImages } = await import("@/actions/listings");
    const input = {
      photos: [{ imageId: "image-1", focalX: 0.25, focalY: 0.75 }],
      basePhotoRevision: 1,
      mutationId: "mutation-1",
    };

    await expect(syncListingImages("listing-1", input)).resolves.toEqual({
      data: { count: 1, photoRevision: 2 },
    });
    expect(syncListingImagesForUserMock).toHaveBeenCalledWith({
      listingId: "listing-1",
      userId: "user_123",
      isAdmin: false,
      input,
    });
  });

  it("AUD-MEDIA-001-EXPIRE-HOTPATH keeps a successful sync when cleanup fails", async () => {
    expireAbandonedListingImageIntentsMock.mockRejectedValue(new Error("expire failed"));
    const { syncListingImages } = await import("@/actions/listings");
    const input = {
      photos: [{ imageId: "image-1", focalX: 0.25, focalY: 0.75 }],
      basePhotoRevision: 1,
      mutationId: "mutation-1",
    };

    await expect(syncListingImages("listing-1", input)).resolves.toEqual({
      data: { count: 1, photoRevision: 2 },
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "syncListingImagesCleanup",
      }),
    );
  });
});

describe("listing NS policy server helpers AUD-PAY-POL-001 LST-WRITEOFF-001", () => {
  const previous = process.env.POLICY_ENFORCE_LISTING_NS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.POLICY_ENFORCE_LISTING_NS;
    } else {
      process.env.POLICY_ENFORCE_LISTING_NS = previous;
    }
  });

  it("AUD-PAY-POL-001 reads getPolicyFlags independently for attribute validation", async () => {
    process.env.POLICY_ENFORCE_LISTING_NS = "true";
    const { validateListingAttributesWithServerPolicy } = await import(
      "@/lib/listings/listing-ns-policy"
    );
    const writeOffId = "write-off";
    const result = validateListingAttributesWithServerPolicy({
      categorySlug: "car",
      definitions: [
        {
          id: writeOffId,
          slug: "write-off-category",
          name: "Insurance write-off category",
          dataType: "select",
          required: false,
          options: JSON.stringify(["None", "Category N", "Category S"]),
        },
      ],
      attributes: [],
    });

    expect(result.fieldErrors[`attr-${writeOffId}`]).toEqual([
      "Insurance write-off category is required.",
    ]);
  });

  it("AUD-PAY-POL-001 LST-WRITEOFF-001 withholds readiness when write-off is missing", async () => {
    process.env.POLICY_ENFORCE_LISTING_NS = "true";
    mockDb.listing.findUnique.mockResolvedValue({
      id: "listing_123",
      status: "DRAFT",
      category: {
        slug: "car",
        attributeDefinitions: [
          {
            id: "write-off",
            slug: "write-off-category",
            name: "Insurance write-off category",
            dataType: "select",
            required: false,
            options: JSON.stringify(["None", "Category N", "Category S"]),
          },
        ],
      },
    });
    mockDb.listingAttributeValue.findFirst.mockResolvedValue(null);
    const { getListingWriteOffReadiness, WRITE_OFF_SUBMIT_ERROR } = await import(
      "@/lib/listings/listing-ns-policy"
    );

    await expect(
      getListingWriteOffReadiness({
        listingId: "listing_123",
        listingStatus: "DRAFT",
      }),
    ).resolves.toEqual({
      ok: false,
      error: WRITE_OFF_SUBMIT_ERROR,
      fieldErrors: {
        "attr-write-off": [WRITE_OFF_SUBMIT_ERROR],
      },
    });
  });
});
