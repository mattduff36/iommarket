import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  transitionListingStatusMock,
  revalidatePathMock,
  reportHandledExceptionMock,
  approveRevisionMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  transitionListingStatusMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  reportHandledExceptionMock: vi.fn(),
  approveRevisionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: transitionListingStatusMock,
}));

vi.mock("@/lib/listings/revisions", () => ({
  approveRevision: approveRevisionMock,
  rejectRevision: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: reportHandledExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: { count: vi.fn() },
    dealerProfile: { count: vi.fn() },
    report: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    payment: { count: vi.fn() },
    category: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    attributeDefinition: { create: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(),
}));

describe("moderateListing ALR-LST-003 ALR-IDN-002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    transitionListingStatusMock.mockResolvedValue({
      listing: { id: "listing-1", status: "REJECTED" },
      notification: null,
    });
  });

  it("rejects unauthorized callers", async () => {
    requireRoleMock.mockRejectedValue(new Error("Forbidden"));
    const { moderateListing } = await import("@/actions/admin");
    await expect(
      moderateListing({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        action: "REJECT",
        expectedRevision: 0,
        reasonCode: "FRAUD",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("passes reason and revision into the lifecycle service", async () => {
    const { moderateListing } = await import("@/actions/admin");
    const result = await moderateListing({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "REJECT",
      expectedRevision: 2,
      reasonCode: "FRAUD",
      moderationSubReason: "fraud.identity-or-ownership",
      moderationTaxonomyVersion: "2026-08-17.1",
      adminNotes: "Test notes",
    });
    expect(result.data).toBeDefined();
    expect(transitionListingStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REJECT",
        expectedRevision: 2,
        reasonCode: "FRAUD",
        moderationSubReason: "fraud.identity-or-ownership",
        moderationTaxonomyVersion: "2026-08-17.1",
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    );
  });

  it("maps an approve-vs-withdraw race without monitoring noise", async () => {
    const { ListingLifecycleConflictError } = await import(
      "@/lib/listings/errors"
    );
    transitionListingStatusMock.mockRejectedValue(
      new ListingLifecycleConflictError(),
    );
    const { moderateListing } = await import("@/actions/admin");

    await expect(
      moderateListing({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        action: "APPROVE",
        expectedRevision: 2,
      }),
    ).resolves.toEqual({
      error:
        "This listing changed before moderation completed. Refresh and try again.",
      conflict: true,
    });
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("maps revision CAS conflicts to the same recoverable response", async () => {
    const { ListingRevisionConflictError } = await import(
      "@/lib/listings/errors"
    );
    approveRevisionMock.mockRejectedValue(new ListingRevisionConflictError());
    const { moderateListing } = await import("@/actions/admin");

    await expect(
      moderateListing({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        action: "APPROVE_REVISION",
        expectedRevision: 2,
        expectedRevisionVersion: 4,
      }),
    ).resolves.toEqual({
      error:
        "This listing changed before moderation completed. Refresh and try again.",
      conflict: true,
    });
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it.each([
    "This listing cannot be reinstated live. Return it to draft instead.",
    "Report does not belong to this listing.",
    "A moderation reason is required.",
  ])("preserves safe actionable lifecycle errors: %s", async (message) => {
    const { ListingLifecycleError } = await import("@/lib/listings/errors");
    transitionListingStatusMock.mockRejectedValue(
      new ListingLifecycleError(message),
    );
    const { moderateListing } = await import("@/actions/admin");

    await expect(
      moderateListing({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        action: "APPROVE",
        expectedRevision: 2,
      }),
    ).resolves.toEqual({ error: message });
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });
});
