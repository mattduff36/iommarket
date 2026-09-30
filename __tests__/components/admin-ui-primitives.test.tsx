// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AdminColumnMenu,
  AdminColumnVisibility,
} from "@/components/admin/admin-column-visibility";
import {
  AdminFilterBar,
  AdminFilterChip,
} from "@/components/admin/admin-filter-bar";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import { adminColumnStorageKey, type AdminColumn } from "@/lib/admin/table-state";

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

  it("reverses the active sort and uses each column's first-click direction", () => {
    const current = { status: "ALL", q: "bmw", page: "3" };
    const sort = { column: "created", direction: "desc" as const, explicit: false };
    render(
      <table>
        <thead>
          <tr>
            <AdminTableHeaderCell
              column={{ id: "created", label: "Date added", defaultDirection: "desc" }}
              sort={sort}
              pathname="/admin/listings"
              current={current}
            />
            <AdminTableHeaderCell
              column={{ id: "price", label: "Price", defaultDirection: "desc", align: "end" }}
              sort={sort}
              pathname="/admin/listings"
              current={current}
            />
            <AdminTableHeaderCell
              column={{ id: "actions", label: "Actions", pinned: true }}
              sort={sort}
              pathname="/admin/listings"
              current={current}
            />
          </tr>
        </thead>
      </table>,
    );

    const added = screen.getByRole("columnheader", { name: "Date added" });
    expect(added.getAttribute("aria-sort")).toBe("descending");
    expect(added.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Date added" }).getAttribute("href"))
      .toBe("/admin/listings?status=ALL&q=bmw&page=1&sort=created&dir=asc");
    expect(screen.getByRole("link", { name: "Price" }).getAttribute("href"))
      .toBe("/admin/listings?status=ALL&q=bmw&page=1&sort=price&dir=desc");
    expect(screen.getByRole("columnheader", { name: "Price" }).getAttribute("aria-sort"))
      .toBe("none");
    expect(screen.queryByRole("link", { name: "Actions" })).toBeNull();
  });

  it("remembers hideable columns per table and restores defaults", async () => {
    const user = userEvent.setup();
    const columns: AdminColumn[] = [
      { id: "title", label: "Title", pinned: true, defaultDirection: "asc" },
      { id: "seller", label: "Seller", defaultDirection: "asc" },
      { id: "region", label: "Region", defaultDirection: "asc", defaultVisible: false },
    ];
    const storageKey = adminColumnStorageKey("demo-table");
    window.localStorage.clear();

    let view = render(
      <AdminColumnVisibility tableId="demo-table" columns={columns}>
        <AdminColumnMenu />
        <table>
          <tbody>
            <tr>
              <td data-column="title">Title</td>
              <td data-column="seller">Seller</td>
              <td data-column="region">Region</td>
            </tr>
          </tbody>
        </table>
      </AdminColumnVisibility>,
    );

    expect(document.querySelector("[data-admin-table='demo-table']")?.getAttribute("data-hidden"))
      .toBe("region");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Title" })).toBeNull();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Seller" }));
    expect(document.querySelector("[data-admin-table='demo-table']")?.getAttribute("data-hidden"))
      .toBe("region seller");

    view.unmount();
    view = render(
      <AdminColumnVisibility tableId="demo-table" columns={columns}>
        <AdminColumnMenu />
      </AdminColumnVisibility>,
    );
    await waitFor(() => {
      expect(document.querySelector("[data-admin-table='demo-table']")?.getAttribute("data-hidden"))
        .toBe("region seller");
    });

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset columns" }));
    expect(document.querySelector("[data-admin-table='demo-table']")?.getAttribute("data-hidden"))
      .toBe("region");
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    window.localStorage.setItem(storageKey, "{");
    view.unmount();
    view = render(
      <AdminColumnVisibility tableId="demo-table" columns={columns}>
        <AdminColumnMenu />
      </AdminColumnVisibility>,
    );
    await waitFor(() => {
      expect(document.querySelector("[data-admin-table='demo-table']")?.getAttribute("data-hidden"))
        .toBe("region");
    });
  });
});
