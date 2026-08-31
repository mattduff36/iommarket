import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactSellerForm } from "@/app/(public)/listings/[id]/contact-form";
import { EMAIL_INVALID_MESSAGE } from "@/lib/validations/email";

const contactSeller = vi.fn();

vi.mock("@/actions/listings", () => ({
  contactSeller: (...args: unknown[]) => contactSeller(...args),
}));

describe("ContactSellerForm FE-07", () => {
  beforeEach(() => {
    contactSeller.mockReset();
  });

  it("shows the real email field message instead of a generic dump", async () => {
    contactSeller.mockResolvedValue({
      error: { email: [EMAIL_INVALID_MESSAGE] },
    });

    render(<ContactSellerForm listingId="clxxxxxxxxxxxxxxxxxxxxxxxxx" />);

    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: "Alex Buyer" },
    });
    fireEvent.change(screen.getByLabelText(/your email/i), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/interested in this item/i), {
      target: { value: "Is this vehicle still available today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getAllByText(EMAIL_INVALID_MESSAGE).length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByText("Unable to send your message right now."),
    ).not.toBeInTheDocument();
  });
});
