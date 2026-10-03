import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAcceptedAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("createSelfServiceDealerProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to create a dealer profile for an admin account", async () => {
    requireAcceptedAuthMock.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      dealerProfile: null,
    });
    const { createSelfServiceDealerProfile } = await import("@/actions/dealer");

    await expect(
      createSelfServiceDealerProfile({ name: "Admin Motors" }),
    ).resolves.toEqual({
      error: "Admin accounts cannot become dealers.",
    });
  });
});
