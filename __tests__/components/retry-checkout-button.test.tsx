// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const {
  payForListingMock,
  upgradeFeaturedMock,
  submitListingForReviewMock,
  pushMock,
  replaceMock,
  navigationMock,
} = vi.hoisted(() => {
  const pushMock = vi.fn();
  const replaceMock = vi.fn();
  return {
    payForListingMock: vi.fn(),
    upgradeFeaturedMock: vi.fn(),
    submitListingForReviewMock: vi.fn(),
    pushMock,
    replaceMock,
    navigationMock: {
      useRouter: () => ({
        push: pushMock,
        replace: replaceMock,
        refresh: vi.fn(),
        prefetch: vi.fn(),
        back: vi.fn(),
      }),
    },
  };
});

vi.mock("@/actions/payments", () => ({
  payForListing: payForListingMock,
  upgradeFeatured: upgradeFeaturedMock,
  simulateDemoListingPaymentOutcome: vi.fn(),
}));

vi.mock("@/actions/listings", () => ({
  submitListingForReview: submitListingForReviewMock,
}));

vi.mock("next/navigation", () => navigationMock);

function render(ui: React.ReactElement) {
  return rtlRender(
    <AppRouterContext.Provider
      value={{
        push: pushMock,
        replace: replaceMock,
        refresh: vi.fn(),
        prefetch: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        bfcacheId: "test",
      }}
    >
      {ui}
    </AppRouterContext.Provider>,
  );
}

vi.mock("@/components/payments/ripple-demo-checkout-dialog", () => ({
  RippleDemoCheckoutDialog: () => null,
  useRippleDemoCheckout: () => ({
    demoCheckoutUrl: null,
    demoDialogOpen: false,
    openCheckout: vi.fn(),
    setDemoDialogOpen: vi.fn(),
  }),
}));

import { RetryCheckoutButton } from "@/app/(public)/sell/checkout/retry-checkout-button";

describe("RetryCheckoutButton private acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payForListingMock.mockResolvedValue({
      data: { checkoutUrl: null, skippedPayment: true },
    });
    submitListingForReviewMock.mockResolvedValue({ data: { id: "listing-1" } });
  });

  it("requires and forwards explicit acceptance on retry", async () => {
    render(<RetryCheckoutButton listingId="listing-1" flow="private" />);

    const retry = screen.getByRole("button", {
      name: "Open payment in new tab",
    });
    expect((retry as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => {
      expect(payForListingMock).toHaveBeenCalledWith({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
      });
      expect(submitListingForReviewMock).toHaveBeenCalledWith({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
      });
    });
    expect(replaceMock).toHaveBeenCalledWith(
      "/sell/success?listing=listing-1&flow=private&payment=skipped",
    );
    expect(pushMock).not.toHaveBeenCalled();
  });


  it.each(["response", "transport"])("requires status review after uncertain %s", async (kind) => {
    if (kind === "transport") payForListingMock.mockRejectedValueOnce(new Error("private-provider-token"));
    else payForListingMock.mockResolvedValueOnce({ error: "Check payment status before paying again.", code: "unknown", retryable: false });
    render(<RetryCheckoutButton listingId="listing-1" flow="dealer" />);
    const button = screen.getByRole("button", { name: "Open payment in new tab" });
    fireEvent.click(button);
    expect(await screen.findByRole("link", { name: "Check payment status" })).toHaveAttribute("href", "/sell/checkout?listing=listing-1");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(payForListingMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("private-provider-token");
  });

  it("LST-REDIRECT-001 uses replace for automatic success navigation", async () => {
    render(<RetryCheckoutButton listingId="listing-1" flow="private" />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open payment in new tab" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/sell/success?listing=listing-1&flow=private&payment=skipped",
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("adds Featured to a paid retry only when selected", async () => {
    payForListingMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/pay/listing-1" },
    });
    render(
      <RetryCheckoutButton
        listingId="listing-1"
        flow="private"
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Add Featured to this checkout" }).getAttribute("aria-checked"),
    ).not.toBe("true");
    expect(screen.getByText(/Total/).textContent).toMatch(/£4\.99/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Featured to this checkout" }));
    expect(screen.getByText(/Total/).textContent).toMatch(/£9\.99/);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open payment in new tab" }));

    await waitFor(() => {
      expect(payForListingMock).toHaveBeenCalledWith({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
        includeFeatured: true,
      });
    });
    expect(submitListingForReviewMock).not.toHaveBeenCalled();
    expect(upgradeFeaturedMock).not.toHaveBeenCalled();
  });

  it("does not offer Featured again when it is already purchased", async () => {
    render(
      <RetryCheckoutButton
        listingId="listing-1"
        flow="private"
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue
        featuredAlreadyPurchased
      />,
    );

    expect(screen.getByText(/does not buy it again/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Add Featured/i })).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open payment in new tab" }));

    await waitFor(() => {
      expect(payForListingMock).toHaveBeenCalledWith({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
      });
    });
    expect(upgradeFeaturedMock).not.toHaveBeenCalled();
  });

  it("starts a separate Featured checkout after a free listing is submitted", async () => {
    upgradeFeaturedMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/featured/listing-1" },
    });
    render(
      <RetryCheckoutButton
        listingId="listing-1"
        flow="private"
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue={false}
      />,
    );

    expect(screen.getByText(/If that Featured payment is declined/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Featured after submission" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open payment in new tab" }));

    await waitFor(() => {
      expect(upgradeFeaturedMock).toHaveBeenCalledWith("listing-1");
    });
    expect(payForListingMock).toHaveBeenCalledWith({
      listingId: "listing-1",
      privateSellerTermsAccepted: true,
    });
    expect(submitListingForReviewMock).toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
