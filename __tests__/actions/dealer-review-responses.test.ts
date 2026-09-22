import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockDb,
  requireAcceptedAuthMock,
  requireRoleMock,
  dispatchNotificationsMock,
  logAdminActionMock,
  checkRateLimitMock,
} = vi.hoisted(() => {
  const mockDb = {
    dealerReview: { findUnique: vi.fn() },
    dealerReviewResponse: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    dealerReviewResponseRevision: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    dealerReviewResponseModerationEvent: { create: vi.fn() },
    dealerReviewDispute: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    dealerReviewDisputeEvent: { create: vi.fn() },
    siteSetting: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  return {
    mockDb,
    requireAcceptedAuthMock: vi.fn(),
    requireRoleMock: vi.fn(),
    dispatchNotificationsMock: vi.fn(),
    logAdminActionMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));
vi.mock("@/lib/email/dealer-review-notifications", () => ({
  dispatchDealerReviewNotifications: dispatchNotificationsMock,
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: vi.fn(
    (scope: string, identifier: string) => `${scope}:${identifier}`,
  ),
}));
vi.mock("@/lib/reviews/device-cookie", () => ({
  getOrCreateReviewDeviceId: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const reviewId = "clreviewxxxxxxxxxxxxxxxxxxx";
const responseId = "clresponsexxxxxxxxxxxxxxxxx";
const revisionId = "clrevisionxxxxxxxxxxxxxxxxx";
const disputeId = "cldisputexxxxxxxxxxxxxxxxxx";

function approvedReview(comment: string | null = "A written review") {
  return {
    id: reviewId,
    status: "APPROVED",
    comment,
    moderationVersion: 6,
    dealer: { id: "dealer-1", slug: "manx-motors", userId: "dealer-user" },
  };
}

describe("dealer review response actions MD-REV-001..005", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-user",
      role: "DEALER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });
    requireRoleMock.mockResolvedValue({ id: "admin-user", role: "ADMIN" });
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
    );
    mockDb.dealerReview.findUnique.mockResolvedValue(approvedReview());
    mockDb.dealerReviewResponse.upsert.mockResolvedValue({
      id: responseId,
      reviewId,
      version: 0,
    });
    mockDb.dealerReviewResponseRevision.findFirst.mockResolvedValue(null);
    mockDb.dealerReviewDispute.findFirst.mockResolvedValue(null);
    mockDb.dealerReviewResponseRevision.updateMany.mockResolvedValue({ count: 1 });
    mockDb.dealerReviewResponse.updateMany.mockResolvedValue({ count: 1 });
    mockDb.dealerReviewDispute.updateMany.mockResolvedValue({ count: 1 });
    dispatchNotificationsMock.mockResolvedValue(undefined);
    checkRateLimitMock.mockReturnValue({ allowed: true });
  });

  it("allows only the DealerProfile owner to create one open response revision", async () => {
    mockDb.dealerReview.findUnique.mockResolvedValueOnce({
      ...approvedReview(),
      dealer: { id: "dealer-1", slug: "manx-motors", userId: "someone-else" },
    });
    const { saveDealerReviewResponseDraft } = await import(
      "@/actions/dealer-reviews"
    );

    const denied = await saveDealerReviewResponseDraft({
      reviewId,
      body: "Thank you for taking the time to leave this review.",
    });
    expect(denied.error).toContain("Not authorized");
    expect(mockDb.dealerReviewResponseRevision.create).not.toHaveBeenCalled();

    mockDb.dealerReview.findUnique.mockResolvedValue(approvedReview());
    mockDb.dealerReviewResponseRevision.findFirst.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Concurrent winner",
      status: "DRAFT",
      version: 0,
    });
    const winner = await saveDealerReviewResponseDraft({
      reviewId,
      body: "Second concurrent body",
    });
    expect(winner).toMatchObject({
      data: { id: revisionId, body: "Concurrent winner" },
      conflict: true,
    });
    expect(mockDb.dealerReviewResponseRevision.create).not.toHaveBeenCalled();
  });

  it("AUD-REVIEW-001b denies response and dispute after dealer account access is lost", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-user",
      role: "USER",
      dealerProfile: { id: "dealer-1", tier: "STARTER" },
    });

    const { saveDealerReviewResponseDraft, openDealerReviewDispute } =
      await import("@/actions/dealer-reviews");

    const draft = await saveDealerReviewResponseDraft({
      reviewId,
      body: "Thank you for taking the time to leave this review.",
    });
    expect(draft.error).toContain("Not authorized");
    expect(mockDb.dealerReviewResponse.upsert).not.toHaveBeenCalled();

    const dispute = await openDealerReviewDispute({
      reviewId,
      reasonCode: "OFF_TOPIC",
      body: "This review concerns a different business and should be assessed.",
    });
    expect(dispute.error).toContain("Not authorized");
    expect(mockDb.dealerReviewDispute.create).not.toHaveBeenCalled();
  });

  it("requires an approved nonblank written review for a response", async () => {
    mockDb.dealerReview.findUnique.mockResolvedValue(approvedReview("  "));
    const { saveDealerReviewResponseDraft } = await import(
      "@/actions/dealer-reviews"
    );
    const result = await saveDealerReviewResponseDraft({
      reviewId,
      body: "A response that should not be accepted.",
    });
    expect(result.error).toContain("written review");
  });

  it("re-reads the winning open revision after a concurrent create", async () => {
    const winner = {
      id: revisionId,
      responseId,
      body: "Winning concurrent draft",
      status: "DRAFT",
      version: 0,
    };
    mockDb.dealerReviewResponseRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    mockDb.dealerReviewResponseRevision.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const { saveDealerReviewResponseDraft } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await saveDealerReviewResponseDraft({
      reviewId,
      body: "Losing concurrent draft",
    });
    expect(result).toEqual({ data: winner, conflict: true });
    expect(mockDb.dealerReviewResponseRevision.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        response: expect.objectContaining({
          reviewId,
          review: { dealer: { userId: "dealer-user" } },
        }),
      }),
    });
  });

  it("never returns raw database errors to the dealer client", async () => {
    mockDb.dealerReviewResponseRevision.create.mockRejectedValue(
      new Error("Prisma query failed at db.internal:5432"),
    );
    const { saveDealerReviewResponseDraft } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await saveDealerReviewResponseDraft({
      reviewId,
      body: "A valid response body",
    });

    expect(result).toEqual({ error: "Failed to save dealer response" });
  });

  it("submits with CAS while leaving the approved public body untouched MD-REV-002", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Pending replacement",
      status: "DRAFT",
      version: 3,
      response: {
        id: responseId,
        version: 7,
        approvedBody: "Existing approved response",
        review: approvedReview(),
      },
    });
    mockDb.dealerReviewResponseRevision.findUniqueOrThrow.mockResolvedValue({
      id: revisionId,
      body: "Pending replacement",
      status: "PENDING",
      version: 4,
    });
    const { submitDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await submitDealerReviewResponse({
      reviewId,
      revisionId,
      expectedVersion: 3,
    });
    expect(result.data).toMatchObject({ status: "PENDING" });
    expect(mockDb.dealerReviewResponse.updateMany).not.toHaveBeenCalled();
    expect(
      mockDb.dealerReviewResponseModerationEvent.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        revisionVersion: 4,
        responseVersion: 7,
      }),
    });
    expect(dispatchNotificationsMock).toHaveBeenCalledWith([
      { kind: "RESPONSE_SUBMITTED", revisionId },
    ]);
  });

  it("publishes an approved revision with response and revision CAS", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Approved dealer response",
      status: "PENDING",
      version: 4,
      response: {
        id: responseId,
        reviewId,
        version: 7,
        review: approvedReview(),
      },
    });
    mockDb.dealerReviewResponseRevision.findUniqueOrThrow.mockResolvedValue({
      id: revisionId,
      status: "APPROVED",
      version: 5,
    });
    const { moderateDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await moderateDealerReviewResponse({
      revisionId,
      expectedVersion: 4,
      expectedResponseVersion: 7,
      decision: "APPROVED",
    });
    expect(result.data).toBeDefined();
    expect(mockDb.dealerReviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: responseId, version: 7 },
      data: expect.objectContaining({
        approvedBody: "Approved dealer response",
        approvedRevisionId: revisionId,
        version: { increment: 1 },
      }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.not.objectContaining({ body: expect.anything() }),
      }),
      mockDb,
    );
  });

  it("returns a recoverable conflict and sends no email on a stale decision", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Pending dealer response",
      status: "PENDING",
      version: 4,
      response: {
        id: responseId,
        reviewId,
        version: 8,
        review: approvedReview(),
      },
    });
    const { moderateDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );
    const result = await moderateDealerReviewResponse({
      revisionId,
      expectedVersion: 4,
      expectedResponseVersion: 7,
      decision: "APPROVED",
    });
    expect(result.error).toContain("Refresh and try again");
    expect(dispatchNotificationsMock).not.toHaveBeenCalled();
  });

  it("allows rejection after parent unapproval and clears stale public state", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Pending dealer response",
      status: "PENDING",
      version: 4,
      response: {
        id: responseId,
        reviewId,
        version: 7,
        approvedBody: "No longer public",
        approvedRevisionId: "approved-revision",
        review: { ...approvedReview(), status: "HIDDEN", moderationVersion: 9 },
      },
    });
    mockDb.dealerReviewResponseRevision.findUniqueOrThrow.mockResolvedValue({
      id: revisionId,
      status: "REJECTED",
      version: 5,
    });
    const { moderateDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await moderateDealerReviewResponse({
      revisionId,
      expectedVersion: 4,
      expectedResponseVersion: 7,
      decision: "REJECTED",
      reasonCode: "OTHER",
      adminNotes: "Parent review changed.",
    });

    expect(result.data).toBeDefined();
    expect(mockDb.dealerReviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: responseId, version: 7 },
      data: {
        approvedBody: null,
        approvedRevisionId: null,
        approvedAt: null,
        version: { increment: 1 },
      },
    });
    expect(
      mockDb.dealerReviewResponseModerationEvent.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({ reviewVersion: 9 }),
    });
  });

  it("still blocks approval when the parent review is not approved", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Pending dealer response",
      status: "PENDING",
      version: 4,
      response: {
        id: responseId,
        reviewId,
        version: 7,
        review: { ...approvedReview(), status: "HIDDEN" },
      },
    });
    const { moderateDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await moderateDealerReviewResponse({
      revisionId,
      expectedVersion: 4,
      expectedResponseVersion: 7,
      decision: "APPROVED",
    });

    expect(result.error).toContain("Only approved reviews");
    expect(mockDb.dealerReviewResponse.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the prior approved body when rejecting under an approved parent", async () => {
    mockDb.dealerReviewResponseRevision.findUnique.mockResolvedValue({
      id: revisionId,
      responseId,
      body: "Rejected replacement",
      status: "PENDING",
      version: 4,
      response: {
        id: responseId,
        reviewId,
        version: 7,
        approvedBody: "Existing approved response",
        approvedRevisionId: "approved-revision",
        review: approvedReview(),
      },
    });
    mockDb.dealerReviewResponseRevision.findUniqueOrThrow.mockResolvedValue({
      id: revisionId,
      status: "REJECTED",
      version: 5,
    });
    const { moderateDealerReviewResponse } = await import(
      "@/actions/dealer-reviews"
    );

    await moderateDealerReviewResponse({
      revisionId,
      expectedVersion: 4,
      expectedResponseVersion: 7,
      decision: "REJECTED",
      reasonCode: "SPAM",
    });

    expect(mockDb.dealerReviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: responseId, version: 7 },
      data: { version: { increment: 1 } },
    });
  });

  it("allows disputes for any approved review without changing ratings", async () => {
    mockDb.dealerReview.findUnique.mockResolvedValue(approvedReview(null));
    mockDb.dealerReviewDispute.create.mockResolvedValue({
      id: disputeId,
      reviewId,
      status: "OPEN",
      version: 0,
    });
    const { openDealerReviewDispute } = await import(
      "@/actions/dealer-reviews"
    );
    const result = await openDealerReviewDispute({
      reviewId,
      reasonCode: "OFF_TOPIC",
      body: "This review concerns a different business and should be assessed.",
    });
    expect(result.data).toMatchObject({ status: "OPEN" });
    expect(mockDb.dealerReviewDispute.create).toHaveBeenCalled();
    expect(dispatchNotificationsMock).toHaveBeenCalledWith([
      { kind: "DISPUTE_OPENED", disputeId },
    ]);
    expect(mockDb.dealerReview).not.toHaveProperty("update");
  });

  it("decides disputes with CAS, an admin audit, and post-commit notification", async () => {
    mockDb.dealerReviewDispute.findUnique.mockResolvedValue({
      id: disputeId,
      reviewId,
      status: "OPEN",
      version: 2,
      review: approvedReview(),
    });
    mockDb.dealerReviewDispute.findUniqueOrThrow.mockResolvedValue({
      id: disputeId,
      status: "RESOLVED",
      version: 3,
    });
    const { decideDealerReviewDispute } = await import(
      "@/actions/dealer-reviews"
    );

    const result = await decideDealerReviewDispute({
      disputeId,
      expectedVersion: 2,
      decision: "RESOLVED",
      reasonCode: "POLICY",
      adminNotes: "Assessed against the review policy.",
    });
    expect(result.data).toMatchObject({ status: "RESOLVED", version: 3 });
    expect(mockDb.dealerReviewDispute.updateMany).toHaveBeenCalledWith({
      where: { id: disputeId, status: "OPEN", version: 2 },
      data: expect.objectContaining({
        status: "RESOLVED",
        version: { increment: 1 },
      }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DEALER_REVIEW_DISPUTE_RESOLVED",
        details: expect.objectContaining({ fromVersion: 2, toVersion: 3 }),
      }),
      mockDb,
    );
    expect(dispatchNotificationsMock).toHaveBeenCalledWith([
      { kind: "DISPUTE_DECIDED", disputeId },
    ]);
  });
});
