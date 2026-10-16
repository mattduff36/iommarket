// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upgradeFeaturedMock } = vi.hoisted(() => ({
  upgradeFeaturedMock: vi.fn(),
}));

vi.mock("@/actions/payments", () => ({
  upgradeFeatured: upgradeFeaturedMock,
}));

vi.mock("@/components/payments/ripple-demo-checkout-dialog", () => ({
  RippleDemoCheckoutDialog: () => null,
  useRippleDemoCheckout: () => ({
    demoCheckoutUrl: null,
    demoDialogOpen: false,
    openCheckout: vi.fn(),
    setDemoDialogOpen: vi.fn(),
  }),
}));

import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";

describe("FeaturedUpgradeButton preview checkout", () => {
  beforeEach(() => {
    upgradeFeaturedMock.mockReset();
  });

  it("shows the normal price and disables new payments on preview", () => {
    render(
      <FeaturedUpgradeButton
        listingId="listing-1"
        featuredUpgradePricePence={500}
        checkoutUnavailable
      />
    );

    const button = screen.getByRole("button", { name: "Upgrade - £5.00" });
    expect(button).toBeDisabled();
    expect(screen.getByText("New payments are disabled on preview.")).toBeTruthy();

    fireEvent.click(button);
    expect(upgradeFeaturedMock).not.toHaveBeenCalled();
  });

  it("says a pending-review purchase activates after approval", () => {
    render(
      <FeaturedUpgradeButton
        listingId="listing-1"
        featuredUpgradePricePence={500}
        pendingReview
      />,
    );

    expect(screen.getByRole("button", { name: "Upgrade - £5.00" })).toBeTruthy();
    expect(screen.getByText("This purchase activates after the listing is approved.")).toBeTruthy();
  });

  it("prices the inline action and blocks a duplicate click while checkout starts", async () => {
    let resolveUpgrade: ((value: { data: { checkoutUrl: string } }) => void) | undefined;
    upgradeFeaturedMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpgrade = resolve;
        }),
    );
    render(
      <FeaturedUpgradeButton
        listingId="listing-1"
        featuredUpgradePricePence={500}
        variant="inline"
        pendingReview
      />,
    );

    const button = screen.getByRole("button", { name: "Feature for £5.00" });
    expect(screen.getByText("This purchase activates after the listing is approved.")).toBeTruthy();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(upgradeFeaturedMock).toHaveBeenCalledTimes(1);
    resolveUpgrade?.({ data: { checkoutUrl: "https://checkout.example/featured" } });
    await screen.findByRole("button", { name: "Feature for £5.00" });
  });

  it("shows a checkout error and allows another attempt", async () => {
    upgradeFeaturedMock
      .mockResolvedValueOnce({ error: "Checkout could not be started." })
      .mockResolvedValueOnce({ data: { checkoutUrl: "https://checkout.example/featured" } });
    render(
      <FeaturedUpgradeButton listingId="listing-1" featuredUpgradePricePence={500} />,
    );

    const button = screen.getByRole("button", { name: "Upgrade - £5.00" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout could not be started.");
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() => expect(upgradeFeaturedMock).toHaveBeenCalledTimes(2));
  });

  it.each(["response", "transport"])("blocks repeat Featured payment after uncertain %s", async (kind) => {
    if (kind === "transport") upgradeFeaturedMock.mockRejectedValue(new Error("private-provider-token"));
    else upgradeFeaturedMock.mockResolvedValue({ error: "Check payment status before paying again.", code: "unknown", retryable: false });
    render(<FeaturedUpgradeButton listingId="listing-1" featuredUpgradePricePence={500} />);
    const button = screen.getByRole("button", { name: "Upgrade - £5.00" });
    fireEvent.click(button);
    expect(await screen.findByRole("link", { name: "Check Featured status" })).toHaveAttribute("href", "/listings/listing-1");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(upgradeFeaturedMock).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent("private-provider-token");
  });

});
