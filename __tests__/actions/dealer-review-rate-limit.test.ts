import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkRateLimitMock,
  getCurrentUserMock,
  requireAcceptedAuthMock,
  dealerFindUniqueMock,
  transactionMock,
  invalidateWorkflowsMock,
  makeRateLimitKeyMock,
  deviceIdMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  requireAcceptedAuthMock: vi.fn(),
  dealerFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
  invalidateWorkflowsMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  deviceIdMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: makeRateLimitKeyMock,
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  requireRole: vi.fn(),
}));
vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));
vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: { findUnique: dealerFindUniqueMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/reviews/device-cookie", () => ({
  getOrCreateReviewDeviceId: deviceIdMock,
}));
vi.mock("@/lib/email/dealer-review-notifications", () => ({
  dispatchDealerReviewNotifications: vi.fn(),
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException: vi.fn() }));
vi.mock("@/lib/reviews/dealer-response-lifecycle", () => ({
  DealerReviewWorkflowConflictError: class extends Error {},
  invalidateDealerReviewWorkflows: invalidateWorkflowsMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dealerId = "cldealerxxxxxxxxxxxxxxxxxxx";
const reviewId = "clreviewxxxxxxxxxxxxxxxxxxx";
const revisionId = "clrevisionxxxxxxxxxxxxxxxxx";

describe("dealer review workflow rate limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "reviewer-1",
      name: "Reviewer",
      disabledAt: null,
    });
    requireAcceptedAuthMock.mockResolvedValue({ id: "dealer-user" });
    makeRateLimitKeyMock.mockImplementation(
      (scope: string, identifier: string) => `${scope}:${identifier}`,
    );
  });

  it("bounds review submissions by aggregate actor before dealer lookup", async () => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: false });
    const { submitDealerReview } = await import("@/actions/dealer-reviews");

    const result = await submitDealerReview({
      dealerId,
      rating: 5,
      comment: "Plain text review",
    });

    expect(result.error).toContain("Too many review updates");
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1);
    expect(dealerFindUniqueMock).not.toHaveBeenCalled();
  });

  it("uses the anonymous device bucket before creating a dealer-target key", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    deviceIdMock.mockResolvedValue("device-123");
    checkRateLimitMock.mockReturnValueOnce({ allowed: false });
    const { submitDealerReview } = await import("@/actions/dealer-reviews");

    await submitDealerReview({ dealerId, rating: 4, comment: "" });

    expect(makeRateLimitKeyMock).toHaveBeenCalledWith(
      "dealer-review-workflow-actor",
      "device:device-123",
    );
    expect(makeRateLimitKeyMock).not.toHaveBeenCalledWith(
      "dealer-review-submit",
      expect.anything(),
    );
  });

  it.each([
    [
      "draft saves",
      () =>
        import("@/actions/dealer-reviews").then(({ saveDealerReviewResponseDraft }) =>
          saveDealerReviewResponseDraft({
            reviewId,
            body: "A valid dealer response",
          }),
        ),
    ],
    [
      "response submissions",
      () =>
        import("@/actions/dealer-reviews").then(({ submitDealerReviewResponse }) =>
          submitDealerReviewResponse({
            reviewId,
            revisionId,
            expectedVersion: 1,
          }),
        ),
    ],
    [
      "dispute openings",
      () =>
        import("@/actions/dealer-reviews").then(({ openDealerReviewDispute }) =>
          openDealerReviewDispute({
            reviewId,
            reasonCode: "POLICY",
            body: "This dispute contains enough detail.",
          }),
        ),
    ],
  ])("bounds %s before transaction and event churn", async (_label, invoke) => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: true });
    checkRateLimitMock.mockReturnValueOnce({ allowed: false });

    const result = await invoke();

    expect(result.error).toContain("Too many");
    expect(checkRateLimitMock).toHaveBeenCalledTimes(2);
    expect(makeRateLimitKeyMock.mock.calls[1]?.[1]).toBe(
      `user:dealer-user:${reviewId}`,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("marks an approved review removed and closes workflows on reviewer edit", async () => {
    const review = {
      id: reviewId,
      status: "APPROVED",
      moderationVersion: 4,
      removedAt: null,
    };
    const tx = {
      dealerReview: {
        findUnique: vi.fn().mockResolvedValue(review),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...review,
          status: "PENDING",
          moderationVersion: 5,
        }),
      },
      dealerReviewModerationEvent: { create: vi.fn() },
    };
    checkRateLimitMock.mockReturnValue({ allowed: true });
    dealerFindUniqueMock.mockResolvedValue({ id: dealerId, slug: "dealer" });
    transactionMock.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );

    const { submitDealerReview } = await import("@/actions/dealer-reviews");
    const result = await submitDealerReview({
      dealerId,
      rating: 3,
      comment: "Updated plain text review",
    });

    expect(result.data).toBeDefined();
    expect(tx.dealerReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          removedAt: expect.any(Date),
          moderationVersion: { increment: 1 },
        }),
      }),
    );
    expect(invalidateWorkflowsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reviewId,
        reviewVersion: 5,
        changedByUserId: null,
      }),
    );
  });
});
