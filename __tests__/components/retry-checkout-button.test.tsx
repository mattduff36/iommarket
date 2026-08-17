import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  payForListingMock,
  submitListingForReviewMock,
  pushMock,
} = vi.hoisted(() => ({
  payForListingMock: vi.fn(),
  submitListingForReviewMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/actions/payments", () => ({
  payForListing: payForListingMock,
  simulateDemoListingPaymentOutcome: vi.fn(),
}));

vi.mock("@/actions/listings", () => ({
  submitListingForReview: submitListingForReviewMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
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
    expect(retry).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    expect(retry).toBeEnabled();
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
    expect(pushMock).toHaveBeenCalledWith(
      "/sell/success?listing=listing-1&flow=private&payment=skipped",
    );
  });
});
