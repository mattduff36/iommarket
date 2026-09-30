// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleCheckoutView } from "@/lib/payments/sample-checkout";
import { cancelSamplePayment, submitSamplePayment } from "@/actions/sample-payments";
import { SampleCheckout } from "@/app/sample-checkout/[id]/checkout";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/actions/sample-payments", () => ({
  cancelSamplePayment: vi.fn(),
  submitSamplePayment: vi.fn(),
}));

const checkout = (overrides: Partial<SampleCheckoutView> = {}): SampleCheckoutView => ({
  id: "caaaaaaaaaaaaaaaaaaaaaaaa",
  kind: "listing_payment",
  description: "Private listing fee",
  amountPence: 1250,
  currency: "gbp",
  status: "PENDING",
  attemptCount: 0,
  returnUrl: "/account/listings",
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...overrides,
});

const submitMock = vi.mocked(submitSamplePayment);
const cancelMock = vi.mocked(cancelSamplePayment);

describe("SampleCheckout", () => {
  beforeEach(() => {
    vi.useRealTimers();
    submitMock.mockReset();
    cancelMock.mockReset();
    pushMock.mockReset();
    window.localStorage.clear();
  });

  it("submits the selected sample approval and returns after showing the server result", async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue({ data: checkout({ status: "SUCCEEDED", attemptCount: 1 }) });
    render(<SampleCheckout checkout={checkout()} />);

    await user.click(screen.getByRole("radio", { name: /successful payment/i }));
    await user.click(screen.getByRole("button", { name: /pay £12\.50/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sample payment approved");
    expect(submitMock).toHaveBeenCalledWith({
      checkoutId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      card: "approve",
      attempt: 1,
    });
    expect(window.localStorage.getItem("itrader:payment-update")).toMatch(/^\d+$/);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/account/listings"), { timeout: 3000 });
  });

  it("keeps a declined result visible after reload and offers a retry picker", async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue({ data: checkout({ status: "FAILED", attemptCount: 2 }) });
    render(<SampleCheckout checkout={checkout({ status: "FAILED", attemptCount: 1 })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Sample card declined");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(screen.getByRole("radiogroup", { name: /choose a sample card outcome/i })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /successful payment/i }));
    await user.click(screen.getByRole("button", { name: /pay £12\.50/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The sample payment was declined.");
    expect(screen.queryByText("Sample payment approved")).not.toBeInTheDocument();
    expect(screen.getByText(/2 of 3 sample attempts used/i)).toBeInTheDocument();
  });

  it("keeps cancellation available after a decline and follows the returned URL", async () => {
    const user = userEvent.setup();
    cancelMock.mockResolvedValue({ data: checkout({ status: "CANCELLED", returnUrl: "/account/listings?cancelled=1" }) });
    render(<SampleCheckout checkout={checkout({ status: "FAILED", attemptCount: 1 })} />);

    await user.click(screen.getByRole("button", { name: /cancel payment/i }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith({ checkoutId: "caaaaaaaaaaaaaaaaaaaaaaaa" }));
    expect(pushMock).toHaveBeenCalledWith("/account/listings?cancelled=1");
    expect(window.localStorage.getItem("itrader:payment-update")).toMatch(/^\d+$/);
  });

  it("disables payment choices after the sample checkout expires", async () => {
    render(<SampleCheckout checkout={checkout({ expiresAt: "2000-01-01T00:00:00.000Z" })} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: /successful payment/i })).toBeDisabled());
    expect(screen.getByRole("button", { name: /pay £12\.50/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("has expired");
  });
});
