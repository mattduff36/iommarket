import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FreeListingWelcomeDialog } from "@/app/(public)/sell/free-listing-welcome-dialog";

const DISMISSAL_KEY = "iomarket:free-listing-welcome-dismissed";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("FreeListingWelcomeDialog", () => {
  it("shows the free-listing message on arrival", async () => {
    render(<FreeListingWelcomeDialog />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "This listing is free!"
    );
    expect(dialog.textContent).toContain("Extensions and renewals require payment.");
  });

  it("keeps the dialog dismissed for the current browser session", async () => {
    const firstRender = render(<FreeListingWelcomeDialog />);

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Start my free listing" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    firstRender.unmount();
    render(<FreeListingWelcomeDialog />);

    expect(window.sessionStorage.getItem(DISMISSAL_KEY)).toBe("true");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
