// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpWithPlans } from "@/components/auth/sign-up-with-plans";
import {
  SIGNUP_VERIFICATION_POLL_MS,
  SIGNUP_VERIFICATION_WINDOW_MS,
  SignupVerificationWait,
} from "@/components/auth/signup-verification-wait";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const signUpMock = vi.fn();
const signInWithPasswordMock = vi.fn();
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

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
    },
  }),
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
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Test Member" },
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
    signInWithPasswordMock.mockReset();
    nextPath = null;
    process.env.NEXT_PUBLIC_APP_URL = "https://iomarket.test";
    signUpMock.mockResolvedValue({ data: { email: "member@example.com" } });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null },
      error: { message: "Email not confirmed" },
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

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(getPasswordInput(), {
      target: { value: "strong-password-123" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Test Member" },
    });
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));

    expect(signUpMock).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "strong-password-123",
      name: "Test Member",
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
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Dealer Member" },
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
      name: "Dealer Member",
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

  it("requires a name before calling the signup action", async () => {
    renderSignup();
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(getPasswordInput(), {
      target: { value: "strong-password-123" },
    });
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpMock).not.toHaveBeenCalled();
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a name of at least 2 characters.",
    );
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
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Invited Member" },
    });
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@example.com" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
  });

  function renderVerificationWait(next = "/account") {
    return render(
      <SignupVerificationWait
        email="member@example.com"
        password="strong-password-123"
        nextPath={next}
        signInHref={`/sign-in?next=${encodeURIComponent(next)}`}
      />,
    );
  }

  it("keeps retrying an unconfirmed email without opening the account", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    renderVerificationWait();

    await act(async () => {
      await Promise.resolve();
    });
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_VERIFICATION_POLL_MS);
    });

    expect(signInWithPasswordMock).toHaveBeenCalledTimes(2);
    expect(signInWithPasswordMock).toHaveBeenNthCalledWith(2, {
      email: "member@example.com",
      password: "strong-password-123",
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("strong-password-123");
  });

  it("does not start another sign-in while the first attempt is still running", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    let resolveSignIn: ((value: unknown) => void) | undefined;
    signInWithPasswordMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    renderVerificationWait();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_VERIFICATION_POLL_MS * 3);
    });
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignIn?.({
        data: { session: null },
        error: { message: "Email not confirmed" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_VERIFICATION_POLL_MS);
    });
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(2);
  });

  it("opens the saved destination only after this browser session is confirmed", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "user-1" }), { status: 200 }),
    );
    renderSignup();
    fillAccountDetails();
    await completeRequiredAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/account"));
    expect(refreshMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(screen.queryByRole("heading", { name: /my listing history/i })).toBeNull();
    fetchMock.mockRestore();
  });

  it("guides the user to sign in when verification succeeds but this browser has no session", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    renderVerificationWait("/dealer/subscribe?tier=PRO");

    expect(
      await screen.findByRole("heading", { name: "Verified — sign in to continue" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/this browser still needs you to sign in/i),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fdealer%2Fsubscribe%3Ftier%3DPRO",
    );
    expect(pushMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("stops automatic sign-in after the waiting window and keeps the manual link", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    renderVerificationWait();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_VERIFICATION_WINDOW_MS);
    });

    expect(screen.getByRole("heading", { name: "Sign in to continue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Faccount",
    );
    const attempts = signInWithPasswordMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_VERIFICATION_POLL_MS * 2);
    });
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(attempts);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not navigate after the waiting view unmounts", async () => {
    let resolveSignIn: ((value: unknown) => void) | undefined;
    signInWithPasswordMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const view = renderVerificationWait();
    view.unmount();

    await act(async () => {
      resolveSignIn?.({ data: { session: { access_token: "token" } }, error: null });
      await Promise.resolve();
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
