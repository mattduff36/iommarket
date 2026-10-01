import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAcceptedAuthMock,
  hasOperationalDealerAccessMock,
  mockDb,
  mockTx,
} = vi.hoisted(() => {
  const mockTx = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      if (query.join("").includes("FOR UPDATE")) {
        return [{ id: "dealer-admin", slug: "admin-dealer" }];
      }
      return [];
    }),
    $executeRaw: vi.fn(async (_query: TemplateStringsArray) => 0),
    dealerProfile: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    dealerProfileSlugHistory: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  };
  return {
    requireAcceptedAuthMock: vi.fn(),
    hasOperationalDealerAccessMock: vi.fn(),
    mockDb: {
      $transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) =>
        callback(mockTx),
      ),
    },
    mockTx,
  };
});

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  hasOperationalDealerAccess: hasOperationalDealerAccessMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: vi.fn(),
}));

describe("updateMyDealerProfile T10", () => {
  const validInput = {
    name: "Admin Motors",
    slug: "admin-motors",
    bio: "Staff dealer profile",
    website: "https://example.com",
    phone: "01624671234",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.$queryRaw.mockImplementation(async (query: TemplateStringsArray) => {
      if (query.join("").includes("FOR UPDATE")) {
        return [{ id: "dealer-admin", slug: "admin-dealer" }];
      }
      return [];
    });
    mockTx.dealerProfile.findFirst.mockResolvedValue(null);
    mockTx.dealerProfile.update.mockResolvedValue({ id: "dealer-admin" });
    mockTx.dealerProfileSlugHistory.findUnique.mockResolvedValue(null);
    mockTx.dealerProfileSlugHistory.count.mockResolvedValue(0);
  });

  it("allows an admin with a dealer profile and no billing entitlement", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      dealerProfile: {
        id: "dealer-admin",
        slug: "admin-dealer",
      },
    });
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    const { updateMyDealerProfile } = await import("@/actions/account");

    await expect(updateMyDealerProfile(validInput)).resolves.toEqual({
      data: { id: "dealer-admin" },
    });
  });

  it("denies an unpaid dealer", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-1",
      role: "DEALER",
      dealerProfile: {
        id: "dealer-1",
        slug: "manx-motors",
      },
    });
    hasOperationalDealerAccessMock.mockResolvedValue(false);
    const { updateMyDealerProfile } = await import("@/actions/account");

    await expect(updateMyDealerProfile(validInput)).resolves.toEqual({
      error: "Active dealer access is required to update a dealer profile",
    });
    expect(mockTx.dealerProfile.update).not.toHaveBeenCalled();
  });

  it("does not consume quota for the generated placeholder address", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "user-123",
      role: "DEALER",
      dealerProfile: { id: "dealer-admin", slug: "dealer-user-123" },
    });
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    mockTx.$queryRaw.mockImplementation(async (query: TemplateStringsArray) => {
      if (query.join("").includes("FOR UPDATE")) {
        return [{ id: "dealer-admin", slug: "dealer-user-123" }];
      }
      return [];
    });
    const { updateMyDealerProfile } = await import("@/actions/account");

    await updateMyDealerProfile(validInput);

    expect(mockTx.dealerProfileSlugHistory.count).toHaveBeenCalled();
    expect(
      mockTx.$executeRaw.mock.calls.some(([query]) =>
        query.join("").includes("set_config"),
      ),
    ).toBe(false);
    expect(mockTx.dealerProfile.update).toHaveBeenCalled();
  });

  it("blocks a third self-service address change in the rolling window", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-1",
      role: "DEALER",
      dealerProfile: { id: "dealer-admin", slug: "admin-dealer" },
    });
    hasOperationalDealerAccessMock.mockResolvedValue(true);
    mockTx.dealerProfileSlugHistory.count.mockResolvedValue(2);
    const { updateMyDealerProfile } = await import("@/actions/account");

    await expect(updateMyDealerProfile(validInput)).resolves.toEqual({
      error: {
        slug: ["Dealer profile addresses can be changed twice in any 365-day period."],
      },
    });
    expect(mockTx.dealerProfile.update).not.toHaveBeenCalled();
  });
});
