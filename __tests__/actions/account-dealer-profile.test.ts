import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAcceptedAuthMock, hasOperationalDealerAccessMock, mockDb } = vi.hoisted(
  () => ({
    requireAcceptedAuthMock: vi.fn(),
    hasOperationalDealerAccessMock: vi.fn(),
    mockDb: {
      dealerProfile: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
  }),
);

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
    mockDb.dealerProfile.findFirst.mockResolvedValue(null);
    mockDb.dealerProfile.update.mockResolvedValue({ id: "dealer-admin" });
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
    expect(mockDb.dealerProfile.update).not.toHaveBeenCalled();
  });
});
