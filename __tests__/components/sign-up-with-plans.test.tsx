import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/actions/auth/sign-up", () => ({
  signUpWithPolicyAcceptance: (...args: unknown[]) => signUpMock(...args),
}));

function getPasswordInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("Expected a password input");

  const label = input.labels?.[0];
  expect(label?.firstChild?.textContent?.trim()).toBe("Password");
  expect(
    label?.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
  ).toBe("*");

  return input;
}

async function completeRequiredAcknowledgements() {
  fireEvent.click(screen.getByLabelText(/I confirm I am 18 or over/i));
  fireEvent.click(screen.getByLabelText(/I acknowledge the/i));
}

describe("SignUpWithPlans", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    refreshMock.mockReset();
    signUpMock.mockReset();
    nextPath = null;
    process.env.NEXT_PUBLIC_APP_URL = "https://iomarket.test";
    signUpMock.mockResolvedValue({ data: { email: "member@example.com" } });
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

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(getPasswordInput(), {
      target: { value: "strong-password-123" },
    });
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
      name: "",
      nextPath: "/account",
      ageAttested: true,
      policiesAccepted: true,
    });
  });

  it("preserves dealer continuation paths when signup starts from dealer subscribe", async () => {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "dealer@example.com" },
    });
    fireEvent.change(getPasswordInput(), {
      target: { value: "strong-password-123" },
    });
    await completeRequiredAcknowledgements();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Create account and continue to Dealer Pro/i,
      })
    );

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "dealer@example.com",
      password: "strong-password-123",
      name: "",
      nextPath: "/dealer/subscribe?tier=PRO",
      ageAttested: true,
      policiesAccepted: true,
    });
  });
});
