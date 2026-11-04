// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AdminDashboardOverview } from "@/components/admin/admin-dashboard-overview";

afterEach(cleanup);

function renderOverview() {
  return render(
    <AdminDashboardOverview trade={<a href="/admin/trade">Open private Trade</a>}>
      <p>Marketplace metrics</p>
    </AdminDashboardOverview>,
  );
}

function controlledPanel(button: HTMLElement) {
  const panel = document.getElementById(button.getAttribute("aria-controls")!);
  expect(panel).not.toBeNull();
  return panel!;
}

async function finishSwitch(button: HTMLElement) {
  await waitFor(() => expect(button.closest("[data-phase]")?.getAttribute("data-phase")).toBe("idle"));
}

describe("AdminDashboardOverview", () => {
  it("starts with Marketplace expanded and Trade inert on the right", () => {
    renderOverview();
    const marketplace = screen.getByRole("button", { name: "Marketplace" });
    const trade = screen.getByRole("button", { name: "Trade Exchange" });

    expect(marketplace.getAttribute("aria-expanded")).toBe("true");
    expect(trade.getAttribute("aria-expanded")).toBe("false");
    expect(controlledPanel(marketplace).hasAttribute("inert")).toBe(false);
    expect(controlledPanel(trade).hasAttribute("inert")).toBe(true);
    expect(controlledPanel(trade).getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("link", { name: "Open private Trade" })).toBeNull();
    expect(marketplace.compareDocumentPosition(trade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches both panels exclusively with keyboard controls and preserves focus", async () => {
    const user = userEvent.setup();
    renderOverview();
    const marketplace = screen.getByRole("button", { name: "Marketplace" });
    const trade = screen.getByRole("button", { name: "Trade Exchange" });

    await user.tab();
    expect(document.activeElement).toBe(marketplace);
    await user.tab();
    expect(document.activeElement).toBe(trade);
    await user.keyboard("{Enter}");
    await finishSwitch(trade);

    expect(document.activeElement).toBe(trade);
    expect(trade.getAttribute("aria-expanded")).toBe("true");
    expect(marketplace.getAttribute("aria-expanded")).toBe("false");
    expect(controlledPanel(marketplace).hasAttribute("inert")).toBe(true);
    expect(controlledPanel(marketplace).getAttribute("aria-hidden")).toBe("true");
    expect(controlledPanel(trade).hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: "Open private Trade" }).getAttribute("href")).toBe("/admin/trade");

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(marketplace);
    await user.keyboard(" ");
    await finishSwitch(marketplace);
    expect(document.activeElement).toBe(marketplace);
    expect(marketplace.getAttribute("aria-expanded")).toBe("true");
    expect(trade.getAttribute("aria-expanded")).toBe("false");
    expect(controlledPanel(marketplace).hasAttribute("inert")).toBe(false);
    expect(controlledPanel(trade).hasAttribute("inert")).toBe(true);

    await user.keyboard("{Enter}");
    expect(marketplace.getAttribute("aria-expanded")).toBe("true");
  });

  it("always uses a right arrow for Marketplace and a left arrow for Trade", async () => {
    const user = userEvent.setup();
    renderOverview();
    const marketplace = screen.getByRole("button", { name: "Marketplace" });
    const trade = screen.getByRole("button", { name: "Trade Exchange" });
    const assertDirections = () => {
      expect(marketplace.querySelector("svg.lucide-arrow-right")).not.toBeNull();
      expect(marketplace.querySelector("svg.lucide-arrow-left")).toBeNull();
      expect(trade.querySelector("svg.lucide-arrow-left")).not.toBeNull();
      expect(trade.querySelector("svg.lucide-arrow-right")).toBeNull();
    };

    assertDirections();
    await user.click(trade);
    await finishSwitch(trade);
    assertDirections();
    await user.click(marketplace);
    await finishSwitch(marketplace);
    assertDirections();
  });

  it("clears both bodies before sliding and reveals only after the slide", async () => {
    const user = userEvent.setup();
    renderOverview();
    const trade = screen.getByRole("button", { name: "Trade Exchange" });
    const marketplace = screen.getByRole("button", { name: "Marketplace" });
    const overview = trade.closest("[data-phase]")!;

    await user.click(trade);
    expect(overview.getAttribute("data-phase")).toBe("clearing");
    expect(marketplace.getAttribute("aria-expanded")).toBe("true");
    expect(controlledPanel(marketplace).hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(overview.getAttribute("data-phase")).toBe("sliding"));
    expect(trade.getAttribute("aria-expanded")).toBe("true");
    expect(controlledPanel(trade).getAttribute("aria-hidden")).toBe("true");
    expect(controlledPanel(marketplace).getAttribute("aria-hidden")).toBe("true");
    // Repeated clicks during a sequence must not interrupt it or expose text.
    await user.click(marketplace);
    expect(trade.getAttribute("aria-expanded")).toBe("true");
    await finishSwitch(trade);
    expect(controlledPanel(trade).hasAttribute("inert")).toBe(false);
    expect(overview.getAttribute("aria-busy")).toBe("false");
  });

  it("renders only Marketplace with no rail or toggle when Trade is absent", () => {
    render(
      <AdminDashboardOverview>
        <p>Marketplace metrics</p>
      </AdminDashboardOverview>,
    );

    expect(screen.getByRole("heading", { name: "Marketplace" })).toBeTruthy();
    expect(screen.getByText("Marketplace metrics")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Trade Exchange")).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

