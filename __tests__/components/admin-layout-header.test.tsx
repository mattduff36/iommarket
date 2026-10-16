// @vitest-environment jsdom
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
  usePathname: () => "/admin/users",
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/layout/site-header", () => ({
  SiteHeader: () => <div data-testid="site-header">Public nav</div>,
}));

vi.mock("@/components/admin/admin-mobile-nav", () => ({
  AdminMobileNav: () => <div>Admin mobile nav</div>,
}));

import { AdminArea } from "@/components/admin/admin-area";
import AdminLayout from "@/app/(admin)/layout";

describe("AdminLayout public header trial", () => {
  beforeEach(() => {
    isAdminMock.mockReset();
    redirectMock.mockReset();
    isAdminMock.mockResolvedValue(true);
  });

  it("renders the home-page site header above admin chrome", async () => {
    const area = await AdminArea({ children: <div>Admin page content</div> });
    const shell = AdminLayout({ children: null });
    expect(shell.props.children[0].type).toBeDefined();
    render(<>{shell.props.children[0]}{area}</>);

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByText("Admin page content")).toBeTruthy();
    expect(screen.getByText("Admin mobile nav")).toBeTruthy();
    expect(screen.queryByText("Back to site")).toBeNull();
  });

  it("does not return admin content when authorization fails", async () => {
    isAdminMock.mockResolvedValue(false);
    redirectMock.mockImplementation(() => { throw new Error("redirected"); });
    await expect(AdminArea({ children: <div>Private admin content</div> })).rejects.toThrow("redirected");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
