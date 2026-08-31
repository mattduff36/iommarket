import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { EMAIL_INVALID_MESSAGE, EMAIL_REQUIRED_MESSAGE } from "@/lib/validations/email";
import {
  WAITLIST_CONSENT_MESSAGE,
  WAITLIST_INTERESTS_MESSAGE,
} from "@/lib/validations/waitlist";

const joinWaitlist = vi.fn();

vi.mock("@/actions/waitlist", () => ({
  joinWaitlist: (...args: unknown[]) => joinWaitlist(...args),
}));

describe("WaitlistForm FE-06", () => {
  it("does not show an email error when a valid email is missing consent", async () => {
    render(<WaitlistForm />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "itrader@ac.tmail.im" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buying cars/i }));
    fireEvent.click(screen.getByRole("button", { name: /join waiting list/i }));

    expect(screen.getAllByText(WAITLIST_CONSENT_MESSAGE).length).toBeGreaterThan(0);
    expect(screen.queryByText(EMAIL_INVALID_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(EMAIL_REQUIRED_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(/valid email required/i)).not.toBeInTheDocument();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("asks the user to choose an interest when none are selected", () => {
    render(<WaitlistForm />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "user@gmail.com" },
    });
    fireEvent.click(screen.getByLabelText(/launch updates/i));
    fireEvent.click(screen.getByRole("button", { name: /join waiting list/i }));

    expect(screen.getAllByText(WAITLIST_INTERESTS_MESSAGE).length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: /what are you interested in/i })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.queryByText(EMAIL_INVALID_MESSAGE)).not.toBeInTheDocument();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });
});
