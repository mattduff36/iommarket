// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

vi.mock("@/actions/hosted-payment-return", () => ({
  confirmHostedListingPayment: confirmMock,
}));

import { HostedPaymentConfirmation } from "@/components/payments/hosted-payment-confirmation";

async function renderAndFlush(ui: React.ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

describe("HostedPaymentConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows waiting until the server confirms, then offers the confirmed listing", async () => {
    confirmMock.mockResolvedValueOnce({ status: "waiting" });
    confirmMock.mockResolvedValueOnce({ status: "confirmed", listingId: "listing/one" });

    await renderAndFlush(<HostedPaymentConfirmation paymentJobRef="1234567890" />);
    expect(screen.getByText("Confirming your payment")).toBeInTheDocument();
    expect(screen.queryByText(/payment is confirmed/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("Your listing payment is confirmed")).toBeInTheDocument();
    expect(screen.getByText(/returning to your original itrader tab/i)).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem("iomarket-payment-return")).toContain('"listingId":"listing/one"');
    expect(screen.queryByRole("link", { name: "Continue to my listing" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByRole("link", { name: "Continue to my listing" })).toHaveAttribute(
      "href",
      "/sell/checkout?listing=listing%2Fone",
    );
  });

  it("shows review after a server review response without implying payment succeeded", async () => {
    confirmMock.mockResolvedValue({ status: "review" });

    await renderAndFlush(<HostedPaymentConfirmation paymentJobRef="1234567890" />);

    expect(screen.getByText("Your payment needs a review")).toBeInTheDocument();
    expect(screen.getByText(/please don’t pay again/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment is confirmed/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("iomarket-payment-return")).toBeNull();
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["dealer_subscription", "Your dealer subscription is confirmed", "/account"],
    ["featured_upgrade", "Your featured upgrade payment is confirmed", "/account/listings"],
  ])("shows the appropriate continuation for %s", async (checkoutType, heading, href) => {
    confirmMock.mockResolvedValue({ status: "confirmed", checkoutType, listingId: checkoutType === "featured_upgrade" ? "listing-1" : undefined });
    await renderAndFlush(<HostedPaymentConfirmation paymentJobRef="1234567890" />);
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", href);
  });

  it("caps repeated waiting responses and moves to review", async () => {
    confirmMock.mockResolvedValue({ status: "waiting" });

    await renderAndFlush(<HostedPaymentConfirmation paymentJobRef="1234567890" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(38 * 3000);
    });
    expect(confirmMock).toHaveBeenCalledTimes(39);
    expect(screen.getByText("Confirming your payment")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Your payment needs a review")).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(40);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries after a rejected request and clears its pending poll on unmount", async () => {
    confirmMock.mockRejectedValueOnce(new Error("temporary failure"));
    confirmMock.mockResolvedValue({ status: "waiting" });

    const view = await renderAndFlush(<HostedPaymentConfirmation paymentJobRef="1234567890" />);
    expect(screen.getByText("Confirming your payment")).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
