import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const {
  payForListingMock,
  submitListingForReviewMock,
  pushMock,
  replaceMock,
  navigationMock,
} = vi.hoisted(() => {
  const pushMock = vi.fn();
  const replaceMock = vi.fn();
  return {
    payForListingMock: vi.fn(),
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
});
