import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withdrawListingSubmission } from "@/actions/listings";
import { WithdrawSubmissionButton } from "@/components/marketplace/withdraw-submission-button";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/actions/listings", () => ({
  withdrawListingSubmission: vi.fn(),
}));

describe("WithdrawSubmissionButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("requires confirmation and returns the seller to editing MD-LIFE-UI-001", async () => {
    vi.mocked(withdrawListingSubmission).mockResolvedValue({
      data: { status: "DRAFT" },
    } as never);
    render(
      <WithdrawSubmissionButton
        listingId="listing-1"
        expectedRevision={4}
        editHref="/sell/private?draft=listing-1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw submission" }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("return to Draft"),
    );
    expect(withdrawListingSubmission).toHaveBeenCalledWith({
      listingId: "listing-1",
      expectedRevision: 4,
    });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/sell/private?draft=listing-1",
      ),
    );
  });

  it("disables and labels the control while withdrawal is pending", async () => {
    let resolveAction:
      | ((value: { data: { status: string } }) => void)
      | undefined;
    vi.mocked(withdrawListingSubmission).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve as typeof resolveAction;
        }) as never,
    );
    render(
      <WithdrawSubmissionButton
        listingId="listing-1"
        expectedRevision={4}
        editHref="/sell/private?draft=listing-1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw submission" }),
    );
    const pendingButton = screen.getByRole("button", { name: "Withdrawing…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveAction?.({ data: { status: "DRAFT" } });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it("announces stale conflicts and refreshes current status", async () => {
    vi.mocked(withdrawListingSubmission).mockResolvedValue({
      error:
        "This submission changed before it could be withdrawn. Refresh and try again.",
      conflict: true,
    });
    render(
      <WithdrawSubmissionButton
        listingId="listing-1"
        expectedRevision={4}
        editHref="/sell/private?draft=listing-1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Withdraw submission" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This submission changed",
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
