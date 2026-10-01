// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  openCheckoutInNewTab,
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";

function Checkout() {
  const state = useRippleDemoCheckout();
  return <>
    <button onClick={() => state.openCheckout("/sample-checkout/sample1")}>Pay</button>
    <RippleDemoCheckoutDialog open={state.demoDialogOpen} onOpenChange={state.setDemoDialogOpen}
      checkoutUrl={state.demoCheckoutUrl} checkoutLabel="listing" />
  </>;
}

describe("checkout tab recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers the same checkout through a user-clicked link when popups are blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<Checkout />);
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByRole("dialog", { name: "Open payment checkout" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open checkout in a new tab" });
    expect(link).toHaveAttribute("href", "/sample-checkout/sample1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("severs the opener and suppresses referrer before navigating provider content", () => {
    const tabDocument = document.implementation.createHTMLDocument();
    const tab = { opener: window, document: tabDocument, location: { replace: vi.fn(() => {
      expect(tab.opener).toBeNull();
      expect(tabDocument.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    }) }, focus: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    expect(openCheckoutInNewTab("https://checkout.example.test/pay")).toBe(true);
    expect(tab.location.replace).toHaveBeenCalledWith("https://checkout.example.test/pay");
    expect(tab.focus).toHaveBeenCalledOnce();
  });
});
