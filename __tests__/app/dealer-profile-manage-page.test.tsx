// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const requireAcceptedUserMock = vi.fn();
const ensureAdminDealerProfileMock = vi.fn();
const hasOperationalDealerAccessMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: requireAcceptedUserMock,
}));

vi.mock("@/lib/dealers/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dealers/access")>(
    "@/lib/dealers/access",
  );
  return {
    ...actual,
    ensureAdminDealerProfile: ensureAdminDealerProfileMock,
  };
});

vi.mock("@/lib/dealers/entitlement", () => ({
  hasOperationalDealerAccess: hasOperationalDealerAccessMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: { upsert: vi.fn() },
  },
}));

vi.mock("@/app/(public)/dealer/profile/dealer-profile-form", () => ({
  DealerProfileForm: () => <div data-testid="dealer-profile-form" />,
}));

describe("DealerProfileManagePage T9", () => {
  const adminUser = {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    role: "ADMIN",
    dealerProfile: {
      id: "dealer-admin",
      slug: "admin-dealer",
      name: "Admin Dealer",
      bio: null,
      website: null,
      phone: null,
      logoUrl: null,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedUserMock.mockResolvedValue({
      ...adminUser,
      dealerProfile: null,
    });
    ensureAdminDealerProfileMock.mockResolvedValue(adminUser);
    hasOperationalDealerAccessMock.mockResolvedValue(true);
  });

  it("sends admins to the admin area without creating a dealer profile", async () => {
    const { default: DealerProfileManagePage } = await import(
      "@/app/(public)/dealer/profile/page"
    );

    await expect(DealerProfileManagePage()).rejects.toThrow("redirect:/admin");
    expect(ensureAdminDealerProfileMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dealer-profile-form")).toBeNull();
  });
});
