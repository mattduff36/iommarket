// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readLinkMock } = vi.hoisted(() => ({ readLinkMock: vi.fn() }));

vi.mock("@/actions/hosted-payment-return", () => ({
  readHostedCheckoutLink: () => readLinkMock(),
}));

import { PaymentReturnActions } from "@/components/payments/payment-return-actions";

describe("PaymentReturnActions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  it("does not close a success return until the payment is linked and acknowledged", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    readLinkMock
      .mockResolvedValueOnce({ status: "waiting", context: "listing", listingId: "listing-1" })
      .mockResolvedValueOnce({ status: "confirmed", context: "listing", listingId: "listing-1" });
    render(
      <PaymentReturnActions
        returnHref="/sell/checkout?listing=listing-1"
        status="success"
        context="listing"
        listingId="listing-1"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/checking that this payment is linked/i)).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText(/returning to your original itrader tab/i)).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();

    const event = JSON.parse(window.localStorage.getItem("iomarket-payment-return") ?? "{}") as { id: string };
    await act(async () => {
      window.localStorage.setItem("iomarket-payment-return-ack", event.id);
      window.dispatchEvent(new StorageEvent("storage", {
        key: "iomarket-payment-return-ack",
        newValue: event.id,
      }));
    });
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it("leaves a failed payment open for retry", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    readLinkMock.mockResolvedValue({ status: "failed", context: "listing", listingId: "listing-1" });
    render(
      <PaymentReturnActions
        returnHref="/sell/checkout?listing=listing-1"
        status="success"
        context="listing"
        listingId="listing-1"
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/was not completed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to itrader/i })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(closeSpy).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("iomarket-payment-return") ?? "{}").status).toBe("failed");
    closeSpy.mockRestore();
  });
});
