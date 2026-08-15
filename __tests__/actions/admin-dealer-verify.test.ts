import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  sendDealerEmailMock,
  mockDb,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  sendDealerEmailMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    dealerProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
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

vi.mock("@/lib/email/dealer-notifications", () => ({
  sendDealerVerificationEmail: sendDealerEmailMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

import { verifyDealer } from "@/actions/admin/dealers";

describe("verifyDealer ALR-MAIL-003", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb),
    );
    mockDb.dealerProfile.findUnique.mockResolvedValue({
      id: "dealer-1",
      name: "Isle Cars",
      verified: false,
      user: { email: "dealer@example.com" },
    });
    mockDb.dealerProfile.update.mockResolvedValue({
      id: "dealer-1",
      verified: true,
    });
  });

  it("emails the dealer after a real verify change", async () => {
    await expect(verifyDealer("dealer-1", true)).resolves.toEqual({
      data: { id: "dealer-1", verified: true },
    });
    expect(sendDealerEmailMock).toHaveBeenCalledWith({
      to: "dealer@example.com",
      dealerName: "Isle Cars",
      verified: true,
    });
  });

  it("does not email when verification is unchanged", async () => {
    mockDb.dealerProfile.findUnique.mockResolvedValue({
      id: "dealer-1",
      name: "Isle Cars",
      verified: true,
      user: { email: "dealer@example.com" },
    });
    mockDb.dealerProfile.update.mockResolvedValue({
      id: "dealer-1",
      verified: true,
    });

    await verifyDealer("dealer-1", true);
    expect(sendDealerEmailMock).not.toHaveBeenCalled();
  });
});
