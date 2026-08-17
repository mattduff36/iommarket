import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  findUnique,
  updateMany,
  findUniqueOrThrow,
  createEvent,
  transaction,
  invalidateWorkflows,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  createEvent: vi.fn(),
  transaction: vi.fn(),
  invalidateWorkflows: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  getCurrentUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("@/lib/reviews/dealer-response-lifecycle", () => ({
  DealerReviewWorkflowConflictError: class extends Error {},
  invalidateDealerReviewWorkflows: invalidateWorkflows,
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transaction,
  },
}));

describe("dealer review moderation ALR-REV-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    findUnique.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "APPROVED",
      moderationVersion: 2,
      dealer: { slug: "manx-motors" },
    });
    updateMany.mockResolvedValue({ count: 1 });
    invalidateWorkflows.mockResolvedValue({
      responseCleared: true,
      revisionsClosed: 1,
      disputesClosed: 1,
    });
    findUniqueOrThrow.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "HIDDEN",
      moderationVersion: 3,
      dealer: { slug: "manx-motors" },
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        dealerReview: { findUnique, updateMany, findUniqueOrThrow },
        dealerReviewModerationEvent: { create: createEvent },
      }),
    );
  });

  it("appends a moderation event instead of erasing prior context", async () => {
    const { moderateDealerReview } = await import("@/actions/dealer-reviews");
    const result = await moderateDealerReview({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 2,
      status: "HIDDEN",
      reasonCode: "POLICY",
      adminNotes: "Withdrawn after complaint",
    });

    expect(result.data).toBeDefined();
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        fromStatus: "APPROVED",
        toStatus: "HIDDEN",
        reasonCode: "POLICY",
        reviewVersion: 3,
      }),
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "HIDDEN",
          removedAt: expect.any(Date),
        }),
      }),
    );
    expect(invalidateWorkflows).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        reviewVersion: 3,
        changedByUserId: "admin-1",
      }),
    );
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MODERATE_DEALER_REVIEW",
        entityType: "DealerReview",
      }),
      expect.anything(),
    );
  });

  it("clears removedAt when a review is approved again", async () => {
    findUnique.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "HIDDEN",
      moderationVersion: 2,
      removedAt: new Date("2026-01-01T00:00:00.000Z"),
      dealer: { slug: "manx-motors" },
    });
    const { moderateDealerReview } = await import("@/actions/dealer-reviews");

    await moderateDealerReview({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 2,
      status: "APPROVED",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ removedAt: null }),
      }),
    );
    expect(invalidateWorkflows).not.toHaveBeenCalled();
  });

  it("AUD-REVIEW-001a refreshes review actions after a successful save", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "app/(admin)/admin/reviews/review-actions.tsx"),
      "utf8",
    );
    expect(source).toContain("useRouter");
    expect(source).toContain("router.refresh()");
  });
});
