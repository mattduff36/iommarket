// @vitest-environment jsdom
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscribeForm } from "@/app/(public)/dealer/subscribe/subscribe-form";
import { acceptDealerSubscribeTerms } from "@/actions/dealer";
import {
  createDealerSubscription,
  simulateDemoDealerSubscriptionOutcome,
} from "@/actions/payments";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/actions/dealer", () => ({
  createSelfServiceDealerProfile: vi.fn(),
  acceptDealerSubscribeTerms: vi.fn().mockResolvedValue({ data: { accepted: true } }),
}));

vi.mock("@/actions/payments", () => ({
  createDealerSubscription: vi.fn(),
  simulateDemoDealerSubscriptionOutcome: vi.fn(),
}));

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => (
    <div data-testid="ripple-embed-script" data-src={src} />
  ),
}));

describe("SubscribeForm demo checkout flow", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.mocked(createDealerSubscription).mockReset();
    vi.mocked(simulateDemoDealerSubscriptionOutcome).mockReset();
    vi.mocked(acceptDealerSubscribeTerms).mockReset();
    vi.mocked(acceptDealerSubscribeTerms).mockResolvedValue({
      data: { accepted: true },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("starts a real subscription through the server action instead of an embedded form", async () => {
    const checkoutUrl = "https://portal.startyourripple.co.uk/card/itrader/pay/8181FAC1359E413E?reference=signed-checkout";
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(createDealerSubscription).mockResolvedValue({ data: { checkoutUrl } });
    render(<SubscribeForm tier="STARTER" tierLabel="Starter" tierPrice="£29.99" features={[]} hasDealerProfile />);
    const subscribe = screen.getByRole("button", { name: "Subscribe for £29.99 per month" });
    expect(subscribe).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I accept the Dealer Terms/i));
    await waitFor(() => expect(subscribe).not.toBeDisabled());
    expect(document.querySelector("[data-ripple-embed-src]")).toBeNull();
    fireEvent.click(subscribe);
    await waitFor(() => expect(createDealerSubscription).toHaveBeenCalledWith({ tier: "STARTER", testPlan: false, acceptedDealerTerms: true }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openSpy.mock.calls[0][0]).toBe(checkoutUrl);
    openSpy.mockRestore();
  });

  it("shows the Ripple demo modal controls for dealer subscriptions", async () => {
    vi.mocked(createDealerSubscription).mockResolvedValue({
      data: {
        checkoutUrl:
          "https://portal.startyourripple.co.uk/card/demo-gym/subscribe-123",
      },
    } as Awaited<ReturnType<typeof createDealerSubscription>>);

    render(
      <SubscribeForm
        tier="STARTER"
        tierLabel="Starter"
        tierPrice="£29.99"
        features={["Up to 30 active listings"]}
        hasDealerProfile
      />
    );

    fireEvent.click(screen.getByLabelText(/I accept the Dealer Terms/i));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /subscribe for/i })).not.toBeDisabled();
    });
    expect(document.querySelector("[data-ripple-embed-src]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /subscribe for/i }));

    await waitFor(() => {
      expect(createDealerSubscription).toHaveBeenCalledWith({
        tier: "STARTER",
        testPlan: false,
        acceptedDealerTerms: true,
      });
    });

    await screen.findByText("Preview the Ripple hosted payment journey");
    expect(
      screen.getByRole("button", { name: "Emulate successful payment" })
    ).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("routes a simulated successful dealer subscription to the dashboard", async () => {
    vi.mocked(createDealerSubscription).mockResolvedValue({
      data: {
        checkoutUrl:
          "https://portal.startyourripple.co.uk/card/demo-gym/subscribe-123",
      },
    } as Awaited<ReturnType<typeof createDealerSubscription>>);
    vi.mocked(simulateDemoDealerSubscriptionOutcome).mockResolvedValue({
      data: {
        subscriptionStatus: "ACTIVE",
        nextUrl: "/dealer/dashboard?subscribed=true",
      },
    } as Awaited<ReturnType<typeof simulateDemoDealerSubscriptionOutcome>>);

    render(
      <SubscribeForm
        tier="PRO"
        tierLabel="Pro"
        tierPrice="£49.99"
        features={["Up to 100 active listings"]}
        hasDealerProfile
      />
    );

    fireEvent.click(screen.getByLabelText(/I accept the Dealer Terms/i));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /subscribe for/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /subscribe for/i }));
    await screen.findByText("Preview the Ripple hosted payment journey");

    fireEvent.click(
      screen.getByRole("button", { name: "Emulate successful payment" })
    );

    await waitFor(() => {
      expect(simulateDemoDealerSubscriptionOutcome).toHaveBeenCalledWith({
        tier: "PRO",
        outcome: "success",
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/dealer/dashboard?subscribed=true"
      );
    });
  });

  it("blocks checkout when terms acceptance cannot be recorded", async () => {
    vi.mocked(acceptDealerSubscribeTerms).mockResolvedValue({
      error: "Unable to record dealer terms acceptance.",
    });

    render(
      <SubscribeForm
        tier="STARTER"
        tierLabel="Starter"
        tierPrice="£29.99"
        features={["Up to 30 active listings"]}
        hasDealerProfile
      />
    );

    fireEvent.click(screen.getByLabelText(/I accept the Dealer Terms/i));

    await waitFor(() => {
      expect(acceptDealerSubscribeTerms).toHaveBeenCalled();
    });
    expect(document.querySelector("[data-ripple-embed-src]")).toBeNull();
    expect(screen.getByRole("button", { name: /subscribe for/i })).toBeDisabled();
    expect(createDealerSubscription).not.toHaveBeenCalled();
    expect(
      screen.getByText("Unable to record dealer terms acceptance."),
    ).toBeTruthy();
  });

  it("keeps new subscription checkout disabled on preview after terms are accepted", async () => {
    render(
      <SubscribeForm
        checkoutUnavailable
        tier="STARTER"
        tierLabel="Starter"
        tierPrice="£29.99"
        features={[]}
        hasDealerProfile
      />
    );

    const subscribe = screen.getByRole("button", {
      name: "Subscribe for £29.99 per month",
    });
    fireEvent.click(screen.getByLabelText(/I accept the Dealer Terms/i));
    await waitFor(() => expect(acceptDealerSubscribeTerms).toHaveBeenCalled());

    expect(subscribe).toBeDisabled();
    expect(
      screen.getByText(
        "New subscriptions are disabled on preview. Existing subscriptions continue to renew."
      )
    ).toBeTruthy();
    expect(createDealerSubscription).not.toHaveBeenCalled();
  });
});
