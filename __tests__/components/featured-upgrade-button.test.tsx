// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
