// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readLinkMock } = vi.hoisted(() => ({
  readLinkMock: vi.fn(),
}));

vi.mock("@/actions/sample-payments", () => ({
  readSamplePaymentStatus: vi.fn(),
}));
vi.mock("@/actions/hosted-payment-return", () => ({
  readHostedCheckoutLink: (...args: unknown[]) => readLinkMock(...args),
}));

import { CheckoutStatusActions } from "@/app/(public)/sell/checkout/checkout-status-actions";
import { createPaymentReturnEvent } from "@/lib/payments/checkout-handoff";

describe("CheckoutStatusActions handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    readLinkMock.mockResolvedValue({
      status: "confirmed",
      context: "listing",
      listingId: "listing-1",
    });
  });

  it("acknowledges a linked payment only after the original page shows the confirmed state", async () => {
    const event = createPaymentReturnEvent({
      status: "success",
      context: "listing",
      listingId: "listing-1",
    });
    const view = render(
      <CheckoutStatusActions
        listingId="listing-1"
        flow="private"
        viewState="opened"
        isAwaitingPayment
      />,
    );

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "iomarket-payment-return",
        newValue: JSON.stringify(event),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem("iomarket-payment-return-ack")).toBeNull();
    expect(screen.getByRole("button", { name: /refresh payment status/i })).toBeInTheDocument();

    view.rerender(
      <CheckoutStatusActions
        listingId="listing-1"
        flow="private"
        viewState="paid"
        isAwaitingPayment={false}
      />,
    );

    expect(window.localStorage.getItem("iomarket-payment-return-ack")).toBe(event.id);
  });
});
