// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpWithPlans } from "@/components/auth/sign-up-with-plans";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const signUpMock = vi.fn();
let nextPath: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
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

function renderSignup() {
  return render(
    <SignUpWithPlans
      showFreeOffer={false}
      slotsRemaining={0}
      isFreeWindowActive={false}
      dealerTierIntent={null}
    />,
  );
}

function fillAccountDetails() {
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
    target: { value: "member@example.com" },
  });
  fireEvent.change(getPasswordInput(), {
    target: { value: "strong-password-123" },
  });
}

function ageCheckbox() {
  return screen.getByRole("checkbox", { name: /I confirm I am 18 or over/i });
}

function policiesCheckbox() {
  return screen.getByRole("checkbox", { name: /I acknowledge the/i });
}

describe("SignUpWithPlans", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
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

  it("hides the private launch offer during dealer signup", () => {
    render(
      <SignUpWithPlans
        showFreeOffer
        slotsRemaining={12}
        isFreeWindowActive
        dealerTierIntent="STARTER"
      />,
    );

    expect(screen.queryByText(/Private seller listings are free during launch/i)).toBeNull();
    expect(screen.queryByText(/free private seller launch spots left/i)).toBeNull();
    expect(screen.getByText(/does not also post private listings/i)).toBeTruthy();
  });

  it("shows the private launch offer for a private signup", () => {
    render(
      <SignUpWithPlans
        showFreeOffer
        slotsRemaining={3}
        isFreeWindowActive={false}
        dealerTierIntent={null}
      />,
    );

    expect(screen.getByText(/3 free private seller launch spots left/i)).toBeTruthy();
  });

  it("shows a field error for each acceptance box left unticked", async () => {
    renderSignup();
    fillAccountDetails();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpMock).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Tick the box to confirm you are 18 or over.");
    expect(alert).toHaveTextContent(
      "Tick the box to acknowledge the Terms, Acceptable Use Policy, and Privacy Policy.",
    );
    expect(ageCheckbox()).toHaveAttribute("aria-invalid", "true");
    expect(policiesCheckbox()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Email" })).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(ageCheckbox()).toHaveFocus());
  });

  it("keeps the error on the acceptance box that is still unticked", () => {
    renderSignup();
    fillAccountDetails();
    fireEvent.click(screen.getByLabelText(/I confirm I am 18 or over/i));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpMock).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Tick the box to acknowledge the Terms, Acceptable Use Policy, and Privacy Policy.",
    );
    expect(alert).not.toHaveTextContent("Tick the box to confirm you are 18 or over.");
    expect(ageCheckbox()).not.toHaveAttribute("aria-invalid");
    expect(policiesCheckbox()).toHaveAttribute("aria-invalid", "true");
  });

  it("clears a corrected acceptance error and submits once both boxes are ticked", async () => {
    renderSignup();
    fillAccountDetails();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(ageCheckbox()).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByLabelText(/I confirm I am 18 or over/i));
    expect(ageCheckbox()).not.toHaveAttribute("aria-invalid");
    expect(policiesCheckbox()).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByLabelText(/I acknowledge the/i));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ ageAttested: true, policiesAccepted: true }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not promise highlighted fields for a provider failure", async () => {
    signUpMock.mockResolvedValue({
      error: "We could not create your account. Check the highlighted fields and try again.",
    });
    renderSignup();
    fillAccountDetails();
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("We could not create your account. Please try again shortly."),
    ).toBeTruthy();
    expect(screen.queryByText(/highlighted fields/i)).toBeNull();
    expect(ageCheckbox()).not.toHaveAttribute("aria-invalid");
    expect(policiesCheckbox()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("keeps a duplicate-account message and still highlights a returned field error", async () => {
    signUpMock.mockResolvedValueOnce({
      error: "An account with this email already exists. Please sign in instead.",
    });
    renderSignup();
    fillAccountDetails();
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    expect(screen.queryByText(/highlighted fields/i)).toBeNull();

    signUpMock.mockResolvedValueOnce({
      error: {
        policiesAccepted: [
          "Tick the box to acknowledge the Terms, Acceptable Use Policy, and Privacy Policy.",
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tick the box to acknowledge the Terms, Acceptable Use Policy, and Privacy Policy.",
    );
    expect(policiesCheckbox()).toHaveAttribute("aria-invalid", "true");
    expect(ageCheckbox()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/highlighted fields/i)).toBeNull();
  });

  it("ignores a second submit while account creation is still pending", async () => {
    let resolveSignup: ((value: { data: { email: string } }) => void) | undefined;
    signUpMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignup = resolve;
        }),
    );
    renderSignup();
    fillAccountDetails();
    await completeRequiredAcknowledgements();
    const submit = screen.getByRole("button", { name: "Create account" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();

    resolveSignup?.({ data: { email: "member@example.com" } });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  });

  it("shows a retry message when signup throws, then accepts a corrected resubmit", async () => {
    signUpMock.mockRejectedValueOnce(new Error("network down"));
    renderSignup();
    fillAccountDetails();
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("We could not create your account. Please try again shortly."),
    ).toBeTruthy();
    expect(screen.queryByText(/highlighted fields/i)).toBeNull();

    signUpMock.mockResolvedValue({ data: { email: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  });

  it("keeps an invited email locked and opens the site after verified signup", async () => {
    signUpMock.mockResolvedValue({ data: { email: "member@example.com", signedIn: true } });
    render(
      <SignUpWithPlans
        showFreeOffer={false}
        slotsRemaining={0}
        isFreeWindowActive={false}
        dealerTierIntent={null}
        inviteEmail="member@example.com"
      />,
    );

    const email = screen.getByRole("textbox", { name: "Email" });
    expect(email).toBeDisabled();
    expect(email).toHaveValue("member@example.com");
    fireEvent.change(email, { target: { value: "other@example.com" } });
    fireEvent.change(getPasswordInput(), { target: { value: "strong-password-123" } });
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@example.com" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
  });
});
