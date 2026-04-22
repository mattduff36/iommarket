import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const getCurrentUserMock = vi.fn();
const getSellLandingPathMock = vi.fn();
const expireStaleLiveListingsMock = vi.fn();

const dbMock = {
  listing: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  listingStatusEvent: {
    findMany: vi.fn(),
  },
  favourite: {
    count: vi.fn(),
  },
  savedSearch: {
    count: vi.fn(),
  },
  dealerReview: {
    count: vi.fn(),
  },
};

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/navigation", () => ({
  getSellLandingPath: getSellLandingPathMock,
}));

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

vi.mock("@/lib/listings/expiry", () => ({
  expireStaleLiveListings: expireStaleLiveListingsMock,
}));

describe("AccountDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      email: "member@example.com",
      name: "Buyer Member",
      role: "USER",
      dealerProfile: null,
    });
    getSellLandingPathMock.mockReturnValue("/sell/private");
    expireStaleLiveListingsMock.mockResolvedValue(undefined);
    dbMock.listing.groupBy.mockResolvedValue([]);
    dbMock.listing.findMany.mockResolvedValue([]);
    dbMock.listingStatusEvent.findMany.mockResolvedValue([]);
    dbMock.favourite.count.mockResolvedValue(4);
    dbMock.savedSearch.count.mockResolvedValue(2);
    dbMock.dealerReview.count.mockResolvedValue(1);
  });

  it("surfaces buyer-first tools while keeping selling and dealer upgrade CTAs", async () => {
    const { default: AccountDashboardPage } = await import("@/app/(public)/account/page");

    render(await AccountDashboardPage());

    expect(
      screen.getByRole("heading", {
        name: /Your Account/i,
      })
    ).toBeTruthy();
    expect(screen.getByText(/Save favourites, keep searches handy/i)).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: /Saved listings/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { name: /Saved searches/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Trusted dealer reviews/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Start selling privately/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Become a dealer/i })).toBeTruthy();
    expect(getSellLandingPathMock).toHaveBeenCalledWith("USER");
  });

  it("shows admin shortcuts instead of dealer tools for admin accounts", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin User",
      role: "ADMIN",
      dealerProfile: null,
    });
    getSellLandingPathMock.mockReturnValue(null);

    const { default: AccountDashboardPage } = await import("@/app/(public)/account/page");

    render(await AccountDashboardPage());

    expect(screen.getByRole("heading", { name: /Admin tools/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Dealer tools/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Become a dealer/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Open admin area/i })).toBeTruthy();
  });
});
