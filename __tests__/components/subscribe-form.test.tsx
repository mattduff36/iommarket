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
    <script data-testid="ripple-embed-script" src={src} />
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
      expect(
        document
          .querySelector("[data-ripple-embed-src]")
          ?.getAttribute("data-ripple-embed-src"),
      ).toBe(
        "https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/embed-signup/-dealer-subscription",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /hosted checkout/i }));

    await waitFor(() => {
      expect(createDealerSubscription).toHaveBeenCalledWith({
        tier: "STARTER",
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
      expect(document.querySelector("[data-ripple-embed-src]")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /hosted checkout/i }));
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

  it("does not mount the dealer embed until terms acceptance is recorded", async () => {
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
    expect(
      screen.getByText("Unable to record dealer terms acceptance."),
    ).toBeTruthy();
  });
});
