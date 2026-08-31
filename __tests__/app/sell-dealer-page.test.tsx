import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const getCurrentUserMock = vi.fn();
const hasOperationalDealerAccessMock = vi.fn();
const getSellFormDataMock = vi.fn();
const getEditableDraftMock = vi.fn();
const ensureAdminDealerProfileMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: getCurrentUserMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  hasOperationalDealerAccess: hasOperationalDealerAccessMock,
}));

vi.mock("@/lib/dealers/access", () => ({
  ensureAdminDealerProfile: ensureAdminDealerProfileMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/listings/editable-draft", () => ({
  getEditableDraft: getEditableDraftMock,
}));

vi.mock("@/app/(public)/sell/sell-form-data", () => ({
  getSellFormData: getSellFormDataMock,
}));

vi.mock("@/app/(public)/sell/create-listing-form", () => ({
  CreateListingForm: ({ mode }: { mode: string }) => (
    <div data-testid="create-listing-form" data-mode={mode} />
  ),
}));

describe("SellDealerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      name: "Manx Motors",
      email: "sales@example.com",
      role: "DEALER",
      dealerProfile: {
        id: "dealer-1",
        tier: "STARTER",
      },
    });
    getSellFormDataMock.mockResolvedValue({
      categories: [],
      regions: [],
      modelOptionsByMake: {},
    });
    getEditableDraftMock.mockResolvedValue(null);
    ensureAdminDealerProfileMock.mockImplementation(async (user: unknown) => user);
    hasOperationalDealerAccessMock.mockResolvedValue(true);
  });

  it("unlocks dealer listing creation for an active admin grant", async () => {
    const { default: SellDealerPage } = await import(
      "@/app/(public)/sell/dealer/page"
    );

    const { container } = render(await SellDealerPage({}));

    expect(screen.getByTestId("create-listing-form").getAttribute("data-mode")).toBe(
      "dealer"
    );
    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });

  it("shows the subscribe state after grant expiry", async () => {
    hasOperationalDealerAccessMock.mockResolvedValue(false);
    const { default: SellDealerPage } = await import(
      "@/app/(public)/sell/dealer/page"
    );

    const { container } = render(await SellDealerPage({}));

    expect(
      screen.getByText(/Active dealer access is required/i)
    ).toBeTruthy();
    expect(screen.queryByTestId("create-listing-form")).toBeNull();
    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });

  it("T2 unlocks dealer listing creation for admins without billing entitlement", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      role: "ADMIN",
      dealerProfile: {
        id: "dealer-admin",
        tier: "STARTER",
      },
    });
    const { default: SellDealerPage } = await import(
      "@/app/(public)/sell/dealer/page"
    );

    render(await SellDealerPage({}));

    expect(screen.getByTestId("create-listing-form").getAttribute("data-mode")).toBe(
      "dealer",
    );
    expect(screen.queryByText(/Active dealer access is required/i)).toBeNull();
  });
});
