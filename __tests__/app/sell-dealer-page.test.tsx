import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const getCurrentUserMock = vi.fn();
const getCurrentDealerEntitlementMock = vi.fn();
const getSellFormDataMock = vi.fn();
const getEditableDraftMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: getCurrentUserMock,
}));

vi.mock("@/lib/dealers/entitlement", () => ({
  getCurrentDealerEntitlement: getCurrentDealerEntitlementMock,
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
  });

  it("unlocks dealer listing creation for an active admin grant", async () => {
    getCurrentDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "grant-1",
      source: "ADMIN_GRANT",
      tier: "STARTER",
      endsAt: new Date("2026-08-19T20:00:00.000Z"),
    });
    const { default: SellDealerPage } = await import(
      "@/app/(public)/sell/dealer/page"
    );

    render(await SellDealerPage({}));

    expect(screen.getByTestId("create-listing-form").getAttribute("data-mode")).toBe(
      "dealer"
    );
  });

  it("shows the subscribe state after grant expiry", async () => {
    getCurrentDealerEntitlementMock.mockResolvedValue(null);
    const { default: SellDealerPage } = await import(
      "@/app/(public)/sell/dealer/page"
    );

    render(await SellDealerPage({}));

    expect(
      screen.getByText(/Active dealer access is required/i)
    ).toBeTruthy();
    expect(screen.queryByTestId("create-listing-form")).toBeNull();
  });
});
