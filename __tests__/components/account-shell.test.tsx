// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";

const nav = vi.hoisted(() => ({ pathname: "/account" }));
const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    prefetch() {},
    back() {},
    forward() {},
  }),
  useSearchParams: () => ({ get: () => null }),
  redirect(path: string): never {
    throw new Error(`redirect:${path}`);
  },
  notFound(): never {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/trade-exchange/flag", () => ({
  isTradeExchangeEnabled: () => true,
}));

import { AccountArea } from "@/components/account/account-area";
import { AccountShell } from "@/components/account/account-shell";

function renderShell(role: UserRole, tradeEnabled = false, dealerSlug: string | null = null) {
  return render(
    <AccountShell role={role} name="Ada" dealerSlug={dealerSlug} tradeEnabled={tradeEnabled}>
      <p>Page body</p>
    </AccountShell>,
  );
}

describe("AccountShell navigation", () => {
  beforeEach(() => {
    nav.pathname = "/account";
    getCurrentUser.mockReset();
  });

  it("shows private links to members and hides dealer and trade controls", () => {
    renderShell("USER", true, "private-motors");

    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/account");
    expect(screen.getByRole("link", { name: "My listings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saved listings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saved searches" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profile & security" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Marketplace" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "Dealer overview" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Public profile" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New listing" })).toBeNull();
  });

  it("shows dealer links, and trade links only when trade is enabled", () => {
    const { rerender } = renderShell("DEALER", false, "ada-motors");

    expect(screen.getByRole("link", { name: "Dealer overview" }).getAttribute("href")).toBe(
      "/dealer/dashboard",
    );
    expect(screen.getByRole("link", { name: "Subscription" }).getAttribute("href")).toBe(
      "/dealer/subscription",
    );
    expect(screen.getByRole("link", { name: "Public profile" }).getAttribute("href")).toBe(
      "/dealers/ada-motors",
    );
    expect(screen.queryByRole("link", { name: "Own stock" })).toBeNull();

    rerender(
      <AccountShell role="DEALER" name="Ada" dealerSlug="ada-motors" tradeEnabled>
        <p>Page body</p>
      </AccountShell>,
    );

    expect(screen.getByRole("link", { name: "Browse" }).getAttribute("href")).toBe("/dealer/trade");
    expect(screen.getByRole("link", { name: "Own stock" }).getAttribute("href")).toBe(
      "/dealer/trade/stock",
    );
    expect(screen.getByRole("link", { name: "Enquiries" }).getAttribute("href")).toBe(
      "/dealer/trade/enquiries",
    );
    expect(screen.getByRole("link", { name: "Saved" }).getAttribute("href")).toBe(
      "/dealer/trade/saved",
    );
  });

  it("marks overview exactly and the longest nested trade link", () => {
    nav.pathname = "/account/listings";
    const view = renderShell("DEALER", true, "ada-motors");
    expect(screen.getByRole("link", { name: "My listings" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();

    nav.pathname = "/dealer/trade/enquiries/enquiry-1";
    view.rerender(
      <AccountShell role="DEALER" name="Ada" dealerSlug="ada-motors" tradeEnabled>
        <p>Page body</p>
      </AccountShell>,
    );
    expect(screen.getByRole("link", { name: "Enquiries" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Browse" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Dealer overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens, closes, and dismisses the mobile menu on navigation", async () => {
    renderShell("USER");
    const menuTrigger = screen.getByRole("button", { name: "Open account menu" });
    fireEvent.click(menuTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Account navigation" });
    expect(within(dialog).getByRole("link", { name: "Notifications" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    fireEvent.click(menuTrigger);
    const reopened = await screen.findByRole("dialog", { name: "Account navigation" });
    fireEvent.click(within(reopened).getByRole("link", { name: "My listings" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("skips chrome on policy, onboarding, and correspondence routes", () => {
    for (const pathname of [
      "/account/accept-policies",
      "/dealer/onboarding/claim",
      "/dealer/correspondence/verify",
    ]) {
      nav.pathname = pathname;
      const { unmount } = renderShell("DEALER", true, "ada-motors");
      expect(screen.getByText("Page body")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open account menu" })).toBeNull();
      unmount();
    }
  });
});

describe("AccountArea", () => {
  beforeEach(() => {
    nav.pathname = "/account";
    getCurrentUser.mockReset();
  });

  it("renders children without chrome or a redirect when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    render(await AccountArea({ children: <p>Bare page</p> }));
    expect(screen.getByText("Bare page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open account menu" })).toBeNull();
  });

  it("passes only a safe name, role, and dealer slug into the shell", async () => {
    getCurrentUser.mockResolvedValue({
      role: "DEALER",
      name: "Ada",
      email: "ada@example.com",
      dealerProfile: { slug: "ada-motors", bio: "private bio" },
    });
    render(await AccountArea({ children: <p>Dealer page</p> }));
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.getByText("Dealer page")).toBeTruthy();
    expect(screen.queryByText("ada@example.com")).toBeNull();
    expect(screen.queryByText("private bio")).toBeNull();
    expect(screen.getByRole("link", { name: "Browse" })).toBeTruthy();
  });

  it("drops an unsafe dealer slug", async () => {
    getCurrentUser.mockResolvedValue({
      role: "DEALER",
      name: "Ada",
      email: "ada@example.com",
      dealerProfile: { slug: "../admin" },
    });
    render(await AccountArea({ children: <p>Dealer page</p> }));
    expect(screen.queryByRole("link", { name: "Public profile" })).toBeNull();
  });
});
