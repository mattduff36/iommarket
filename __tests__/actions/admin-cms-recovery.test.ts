import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  waitlistUpdate,
  pageUpdate,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  waitlistUpdate: vi.fn(),
  pageUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    waitlistUser: { update: waitlistUpdate },
    contentPage: { update: pageUpdate },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        waitlistUser: { update: waitlistUpdate },
        contentPage: { update: pageUpdate },
      }),
  },
}));

describe("cms and waitlist recovery ALR-CMS-001 ALR-AUD-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    waitlistUpdate.mockResolvedValue({ id: "wait-1" });
    pageUpdate.mockResolvedValue({ id: "page-1", slug: "terms" });
  });

  it("restores a soft-deleted waitlist row and audits the action", async () => {
    const { restoreWaitlistUser } = await import("@/actions/waitlist");
    await expect(restoreWaitlistUser("wait-1")).resolves.toEqual({ success: true });
    expect(waitlistUpdate).toHaveBeenCalledWith({
      where: { id: "wait-1" },
      data: { deletedAt: null, deletedByAdminId: null, deletionReason: null },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RESTORE_WAITLIST_USER",
        entityType: "WaitlistUser",
      }),
      expect.anything(),
    );
  });

  it("restores a soft-deleted content page and audits the action", async () => {
    const { restoreContentPage } = await import("@/actions/admin/pages");
    await expect(restoreContentPage("page-1")).resolves.toEqual({
      data: { id: "page-1", slug: "terms" },
    });
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { deletedAt: null },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RESTORE_CONTENT_PAGE",
        entityType: "ContentPage",
      }),
      expect.anything(),
    );
  });
});
