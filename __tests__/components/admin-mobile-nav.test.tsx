// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { ADMIN_NAV } from "@/lib/admin/nav";

describe("AdminMobileNav", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });
  it("keeps every navigation group in an independently scrollable menu region", async () => {
    render(<AdminMobileNav items={ADMIN_NAV} />);

    const trigger = screen.getByRole("button", { name: "Open admin menu" });
    expect(trigger.parentElement).toBe(document.body);
    expect(trigger.className).not.toContain("sticky");

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

  it("omits the optional checklist when no feature-gated navigation is supplied", async () => {
    render(<AdminMobileNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open admin menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Admin Navigation" });
    expect(within(dialog).queryByRole("link", { name: "Checklist" })).toBeNull();
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
