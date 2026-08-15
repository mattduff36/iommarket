import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  findUnique,
  update,
  createEvent,
  transaction,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  createEvent: vi.fn(),
  transaction: vi.fn(),
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
      dealer: { slug: "manx-motors" },
    });
    update.mockResolvedValue({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "HIDDEN",
      dealer: { slug: "manx-motors" },
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        dealerReview: { findUnique, update },
        dealerReviewModerationEvent: { create: createEvent },
      }),
    );
  });

  it("appends a moderation event instead of erasing prior context", async () => {
    const { moderateDealerReview } = await import("@/actions/dealer-reviews");
    const result = await moderateDealerReview({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
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
      }),
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MODERATE_DEALER_REVIEW",
        entityType: "DealerReview",
      }),
      expect.anything(),
    );
  });
});
