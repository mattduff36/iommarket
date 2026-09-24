import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AdminFilterBar,
  AdminFilterChip,
} from "@/components/admin/admin-filter-bar";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(() => "/admin/users"),
}));

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
}));

describe("admin UI primitives", () => {
  it("groups page context and actions under one heading", () => {
    render(
      <AdminPageHeader
        title="Users"
        description="Manage account access."
        meta={<span>40 users</span>}
        actions={<button type="button">Invite</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.getByText("Manage account access.")).toBeTruthy();
    expect(screen.getByText("40 users")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
  });

  it("announces the active filter", () => {
    render(
      <AdminFilterBar count="12 results">
        <AdminFilterChip href="/admin/users?role=DEALER" active>
          Dealers
        </AdminFilterChip>
      </AdminFilterBar>,
    );

    expect(screen.getByRole("region", { name: "Filters" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dealers" }).getAttribute("aria-current"))
      .toBe("page");
    expect(screen.getByText("12 results")).toBeTruthy();
  });

  it("renders pager boundaries as disabled text rather than dead links", () => {
    render(
      <AdminPager
        page={1}
        totalPages={2}
        hrefForPage={(page) => `/admin/users?page=${page}`}
      />,
    );

    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href"))
      .toBe("/admin/users?page=2");
  });

  it("marks matching nested admin routes as current", () => {
    render(
      <AdminNavLink
        item={{
          label: "Users",
          href: "/admin/users",
          icon: "users",
          group: "core",
        }}
        accentClass="text-neon-blue-400"
      />,
    );

    expect(screen.getByRole("link", { name: "Users" }).getAttribute("aria-current"))
      .toBe("page");
  });
});
