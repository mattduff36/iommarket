// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountRowActions } from "@/components/account/account-row-actions";

describe("AccountRowActions", () => {
  it("keeps destructive actions separate and restores focus from the keyboard", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <AccountRowActions
        label="Actions for a saved BMW search"
        actions={[
          { kind: "command", id: "hidden", label: "Hidden", hidden: true, onSelect: vi.fn() },
          { kind: "link", id: "open", label: "Open search", href: "/search?q=bmw" },
          { kind: "command", id: "delete", label: "Delete", destructive: true, onSelect: onDelete },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for a saved BMW search" }));
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).not.toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Open search", "Delete"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for a saved BMW search" })).toHaveFocus();
  });

  it("disables the menu while an action is pending", () => {
    render(
      <AccountRowActions
        label="Actions for a listing"
        pendingLabel="Removing…"
        actions={[{ kind: "command", id: "delete", label: "Delete", destructive: true, onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions for a listing. Removing…" })).toBeDisabled();
  });
});
