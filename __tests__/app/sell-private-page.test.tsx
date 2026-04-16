import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const getCurrentUserMock = vi.fn();
const getSellFormDataMock = vi.fn();
const isPrivateListingFreeForUserMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/config/marketplace", () => ({
  isPrivateListingFreeForUser: isPrivateListingFreeForUserMock,
}));

vi.mock("@/app/(public)/sell/sell-form-data", () => ({
  getSellFormData: getSellFormDataMock,
}));

vi.mock("@/app/(public)/sell/create-listing-form", () => ({
  CreateListingForm: ({
    mode,
    isFreeForUser,
  }: {
    mode: string;
    isFreeForUser: boolean;
  }) => (
    <div
      data-testid="create-listing-form"
      data-mode={mode}
      data-free-for-user={String(isFreeForUser)}
    />
  ),
}));

describe("SellPrivatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      role: "USER",
    });
    getSellFormDataMock.mockResolvedValue({
      categories: [],
      regions: [],
    });
    isPrivateListingFreeForUserMock.mockResolvedValue(true);
  });

  it("renders the private listing form page", async () => {
    const { default: SellPrivatePage } = await import(
      "@/app/(public)/sell/private/page"
    );

    render(await SellPrivatePage());

    expect(screen.getByRole("heading", { name: /Private Listing/i })).toBeTruthy();
    const form = screen.getByTestId("create-listing-form");
    expect(form.getAttribute("data-mode")).toBe("private");
    expect(form.getAttribute("data-free-for-user")).toBe("true");
    expect(isPrivateListingFreeForUserMock).toHaveBeenCalledWith("user-1");
  });

  it("redirects dealers to the dealer flow", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "dealer-1",
      role: "DEALER",
    });

    const { default: SellPrivatePage } = await import(
      "@/app/(public)/sell/private/page"
    );

    await expect(SellPrivatePage()).rejects.toThrow("redirect:/sell/dealer");
    expect(redirectMock).toHaveBeenCalledWith("/sell/dealer");
  });
});
