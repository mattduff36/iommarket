// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { attachMock, refreshMock } = vi.hoisted(() => ({
  attachMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/actions/admin/payments", () => ({
  adminAttachUnmatchedListing: attachMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AttachInboxForm } from "@/app/(admin)/admin/payments/attach-inbox-form";

describe("AttachInboxForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachMock.mockResolvedValue({ data: {} });
  });

  it("requires staff to confirm current Ripple payment state and listing match", async () => {
    render(<AttachInboxForm inboxId="cbbbbbbbbbbbbbbbbbbbbbbbb" />);

    const attachButton = screen.getByRole("button", { name: "Attach to listing" });
    expect(attachButton).toBeDisabled();
    expect(
      screen.getByText(
        /current Ripple portal that this transaction is Paid, has not been Refunded, and is the listing fee for this listing/i,
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Listing ID"), {
      target: { value: "caaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(attachButton).toBeEnabled();

    fireEvent.click(attachButton);

    await waitFor(() =>
      expect(attachMock).toHaveBeenCalledWith({
        inboxId: "cbbbbbbbbbbbbbbbbbbbbbbbb",
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        confirmedCurrentlyPaidAndNotRefunded: true,
      }),
    );
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
