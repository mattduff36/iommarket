// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedSearchActions } from "@/app/(public)/account/saved-searches/saved-search-actions";

const refreshMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/actions/user-tools", () => ({
  deleteSavedSearch: (...args: unknown[]) => deleteMock(...args),
}));

describe("SavedSearchActions", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    deleteMock.mockReset();
  });

  it("confirms deletion, reports failure, and acknowledges success", async () => {
    const user = userEvent.setup();
    deleteMock
      .mockResolvedValueOnce({ error: "Not authorized" })
      .mockResolvedValueOnce({ data: { ok: true } });
    render(
      <SavedSearchActions
        savedSearchId="ss-1"
        name="BMW search"
        href="/search?q=bmw"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for BMW search" }));
    expect(screen.getByRole("menuitem", { name: "Open search" })).toHaveAttribute(
      "href",
      "/search?q=bmw",
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Actions for BMW search" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Actions for BMW search" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Actions for BMW search" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete saved search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");

    await user.click(screen.getByRole("button", { name: "Actions for BMW search" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete saved search" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2));
    expect(deleteMock).toHaveBeenCalledWith({ savedSearchId: "ss-1" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved search removed.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
