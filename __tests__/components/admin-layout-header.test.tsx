import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isAdminMock, redirectMock } = vi.hoisted(() => ({
  isAdminMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  isAdmin: isAdminMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/components/layout/site-header", () => ({
  SiteHeader: () => <div data-testid="site-header">Public nav</div>,
}));

vi.mock("@/components/admin/admin-mobile-nav", () => ({
  AdminMobileNav: () => <div>Admin mobile nav</div>,
}));

import AdminLayout from "@/app/(admin)/layout";

describe("AdminLayout public header trial", () => {
  beforeEach(() => {
    isAdminMock.mockReset();
    redirectMock.mockReset();
    isAdminMock.mockResolvedValue(true);
  });

  it("renders the home-page site header above admin chrome", async () => {
    const ui = await AdminLayout({ children: <div>Admin page content</div> });
    render(ui);

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByText("Admin page content")).toBeTruthy();
    expect(screen.getByText("Admin mobile nav")).toBeTruthy();
    expect(screen.queryByText("Back to site")).toBeNull();
  });
});
