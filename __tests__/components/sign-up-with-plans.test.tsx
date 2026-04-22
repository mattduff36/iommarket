import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpWithPlans } from "@/components/auth/sign-up-with-plans";

const refreshMock = vi.fn();
const signUpMock = vi.fn();
let nextPath: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === "next" ? nextPath : null),
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signUp: signUpMock,
    },
  }),
}));

describe("SignUpWithPlans", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    refreshMock.mockReset();
    signUpMock.mockReset();
    nextPath = null;
    process.env.NEXT_PUBLIC_APP_URL = "https://iomarket.test";

    signUpMock.mockResolvedValue({
      data: {
        user: {
          identities: [{}],
        },
      },
      error: null,
    });
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("shows general account messaging and defaults new signups to /account", async () => {
    render(
      <SignUpWithPlans
        showFreeOffer={false}
        slotsRemaining={0}
        isFreeWindowActive={false}
        dealerTierIntent={null}
      />
    );

    expect(
      screen.getByRole("heading", {
        name: /Create an account to save, browse, and sell/i,
      })
    ).toBeTruthy();
    expect(screen.queryByText(/Choose your plan to create your account/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "strong-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
      options: {
        data: {},
        emailRedirectTo: "https://iomarket.test/auth/callback?next=%2Faccount",
      },
    });
  });

  it("preserves dealer continuation paths and metadata when signup starts from dealer subscribe", async () => {
    nextPath = "/dealer/subscribe?tier=PRO";

    render(
      <SignUpWithPlans
        showFreeOffer={false}
        slotsRemaining={0}
        isFreeWindowActive={false}
        dealerTierIntent="PRO"
      />
    );

    expect(
      screen.getByRole("heading", {
        name: /Create your account to continue/i,
      })
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "dealer@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "strong-password-123" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Create account and continue to Dealer Pro/i,
      })
    );

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "dealer@example.com",
      password: "strong-password-123",
      options: {
        data: {
          dealer_tier_intent: "PRO",
        },
        emailRedirectTo:
          "https://iomarket.test/auth/callback?next=%2Fdealer%2Fsubscribe%3Ftier%3DPRO",
      },
    });
  });
});
