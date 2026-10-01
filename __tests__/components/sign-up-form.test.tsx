// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "@/components/auth/sign-up-form";

const refreshMock = vi.fn();
const signUpMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
  }),
}));

function fillValidAccount() {
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
    target: { value: "member@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "strong-password-123" },
  });
}

describe("SignUpForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    signUpMock.mockReset();
    signUpMock.mockResolvedValue({
      data: { user: { identities: [{ id: "user-1" }] } },
      error: null,
    });
  });

  it("shows the invalid field and clears it once that field is corrected", async () => {
    render(<SignUpForm />);
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "not-an-email" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(signUpMock).not.toHaveBeenCalled();
    const email = screen.getByRole("textbox", { name: "Email" });
    const password = screen.getByLabelText(/^Password/);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(email).toHaveFocus());

    fireEvent.change(email, { target: { value: "member@example.com" } });
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(password).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(password, { target: { value: "strong-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
  });

  it("does not promise highlighted fields when signup fails without field errors", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null },
      error: { message: "We could not create your account. Check the highlighted fields and try again." },
    });
    render(<SignUpForm />);
    fillValidAccount();
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(
      await screen.findByText("We could not create your account. Please try again shortly."),
    ).toBeTruthy();
    expect(screen.queryByText(/highlighted fields/i)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Email" })).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Sign up" })).toBeEnabled();
  });

  it("shows a retry message when signup throws, then accepts another attempt", async () => {
    signUpMock.mockRejectedValueOnce(new Error("network down"));
    render(<SignUpForm />);
    fillValidAccount();
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(
      await screen.findByText("We could not create your account. Please try again shortly."),
    ).toBeTruthy();

    signUpMock.mockResolvedValue({
      data: { user: { identities: [{ id: "user-1" }] } },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByText(/Check your email to confirm your account/i)).toBeTruthy();
    expect(signUpMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a second submit while signup is pending", async () => {
    let resolveSignup: ((value: unknown) => void) | undefined;
    signUpMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignup = resolve;
        }),
    );
    render(<SignUpForm />);
    fillValidAccount();
    const submit = screen.getByRole("button", { name: "Sign up" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();

    resolveSignup?.({
      data: { user: { identities: [{ id: "user-1" }] } },
      error: null,
    });
    expect(await screen.findByText(/Check your email to confirm your account/i)).toBeTruthy();
  });
});
