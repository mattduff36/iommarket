import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

describe("AdminMobileNav", () => {
  it("keeps every navigation group in an independently scrollable menu region", async () => {
    render(<AdminMobileNav />);

    const adminBar = screen.getByRole("button", { name: "Open admin menu" }).parentElement;
    expect(adminBar?.className).toContain("top-16");
    expect(adminBar?.className).toContain("sm:top-20");

    fireEvent.click(screen.getByRole("button", { name: "Open admin menu" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Admin Navigation",
    });
    const navigationRegion = within(dialog).getByRole("region", {
      name: "Admin navigation",
    });

    expect(navigationRegion.getAttribute("data-scroll-region")).toBe(
      "admin-navigation",
    );
    expect(within(navigationRegion).getByRole("link", { name: "Settings" }))
      .not.toBeNull();
    expect(
      within(navigationRegion)
        .getByRole("link", { name: "Checklist" })
        .getAttribute("href"),
    ).toBe("/admin/checklist");
    expect(within(dialog).queryByRole("link", { name: "Back to site" })).toBeNull();
  });

  it("returns focus to the menu trigger and can reopen", async () => {
    render(<AdminMobileNav />);

    const menuTrigger = screen.getByRole("button", {
      name: "Open admin menu",
    });
    menuTrigger.focus();
    fireEvent.click(menuTrigger);
    await screen.findByRole("dialog", { name: "Admin Navigation" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(menuTrigger);

    fireEvent.click(menuTrigger);
    expect(await screen.findByRole("dialog", { name: "Admin Navigation" }))
      .not.toBeNull();
  });
});
