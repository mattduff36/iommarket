// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutStatusActions } from "@/app/(public)/sell/checkout/checkout-status-actions";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/payments/payment-awaiting-status", () => ({
  usePaymentConfirmationPoll: vi.fn(),
}));

describe("CheckoutStatusActions", () => {
  it("offers staff review without redirecting or initiating a new payment", () => {
    render(
      <CheckoutStatusActions
        listingId="caaaaaaaaaaaaaaaaaaaaaaaa"
        flow="private"
        viewState="review"
        isAwaitingPayment
      />,
    );
    expect(replaceMock).not.toHaveBeenCalled();
    const contact = screen.getByRole("link", { name: /email payment support/i });
    expect(contact.getAttribute("href")).toMatch(/^mailto:hello@itrader.im\?/);
    expect(decodeURIComponent(contact.getAttribute("href")!)).toContain("caaaaaaaaaaaaaaaaaaaaaaaa");
    expect(screen.getByText(/sending the email does not confirm payment/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open payment/i })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    replaceMock.mockReset();
  });

  it("redirects to /sell/success when the listing is submitted", () => {
    render(
      <CheckoutStatusActions
        listingId="caaaaaaaaaaaaaaaaaaaaaaaa"
        flow="private"
        viewState="submitted"
        isAwaitingPayment={false}
      />,
    );

    expect(replaceMock).toHaveBeenCalledWith(
      "/sell/success?listing=caaaaaaaaaaaaaaaaaaaaaaaa&flow=private&payment=paid",
    );
  });

  it("redirects to /sell/success when payment is recorded", () => {
    render(
      <CheckoutStatusActions
        listingId="caaaaaaaaaaaaaaaaaaaaaaaa"
        flow="private"
        viewState="paid"
        isAwaitingPayment={false}
      />,
    );

    expect(replaceMock).toHaveBeenCalledWith(
      "/sell/success?listing=caaaaaaaaaaaaaaaaaaaaaaaa&flow=private&payment=paid",
    );
    expect(screen.getByRole("button", { name: /refresh payment status/i })).toBeTruthy();
  });

  it("does not redirect while waiting for the webhook", () => {
    render(
      <CheckoutStatusActions
        listingId="caaaaaaaaaaaaaaaaaaaaaaaa"
        flow="private"
        viewState="waiting"
        isAwaitingPayment
      />,
    );

    expect(replaceMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Ripple does not redirect back here after payment/i),
    ).toBeTruthy();
  });
});
