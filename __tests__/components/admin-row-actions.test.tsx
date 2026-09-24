import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminRowActions } from "@/components/admin/admin-row-actions";

describe("AdminRowActions", () => {
  it("keeps destructive actions separate and omits hidden actions", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <AdminRowActions
        label="Actions for TD Car Centre"
        actions={[
          { kind: "command", id: "hidden", label: "Hidden", hidden: true, onSelect: vi.fn() },
          { kind: "link", id: "view", label: "View account", href: "/admin/users/1" },
          { kind: "command", id: "delete", label: "Delete", destructive: true, onSelect: onDelete },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for TD Car Centre" }));
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).not.toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["View account", "Delete"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for TD Car Centre" })).toHaveFocus();
  });

  it("disables choices while an action is pending", () => {
    render(
      <AdminRowActions
        label="Actions for a region"
        pendingLabel="Deleting…"
        actions={[{ kind: "command", id: "delete", label: "Delete", destructive: true, onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions for a region. Deleting…" })).toBeDisabled();
  });
});
