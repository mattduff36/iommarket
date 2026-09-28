import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, findUniqueMock, transactionMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  findUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({
  reportHandledException: vi.fn(),
}));

describe("createDealerProfile consent gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    findUniqueMock.mockResolvedValue({
      id: "cluserxxxxxxxxxxxxxxxxxxxx",
      role: "USER",
      dealerProfile: null,
    });
  });

  it("does not directly activate a private user", async () => {
    const { createDealerProfile } = await import("@/actions/admin/dealers");

    await expect(
      createDealerProfile({
        userId: "cluserxxxxxxxxxxxxxxxxxxxx",
        name: "Private Motors",
        slug: "private-motors",
        grantDurationDays: 90,
      }),
    ).resolves.toEqual({
      error: expect.stringMatching(/upgrade offer.*accept/i),
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rechecks the role inside the serializable transaction", async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: "cluserxxxxxxxxxxxxxxxxxxxx",
      role: "DEALER",
      dealerProfile: null,
    });
    const createProfileMock = vi.fn();
    transactionMock.mockImplementationOnce(async (callback) =>
      callback({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            role: "USER",
            dealerProfile: null,
          }),
        },
        dealerProfile: { create: createProfileMock },
      }),
    );
    const { createDealerProfile } = await import("@/actions/admin/dealers");

    const result = await createDealerProfile({
      userId: "cluserxxxxxxxxxxxxxxxxxxxx",
      name: "Private Motors",
      slug: "private-motors",
      grantDurationDays: 90,
    });

    expect(result).toEqual({
      error: expect.stringMatching(/upgrade offer.*accept/i),
    });
    expect(createProfileMock).not.toHaveBeenCalled();
  });
});
