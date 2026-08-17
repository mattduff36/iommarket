import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moderateListing } from "@/actions/admin";
import { ListingModerationActions } from "@/components/admin/listing-moderation-actions";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/actions/admin", () => ({
  moderateListing: vi.fn(),
  setListingFeatured: vi.fn(),
}));

describe("ListingModerationActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows and refreshes after a moderation conflict", async () => {
    vi.mocked(moderateListing).mockResolvedValue({
      error:
        "This listing changed before moderation completed. Refresh and try again.",
      conflict: true,
    });
    render(
      <ListingModerationActions
        listingId="listing-1"
        currentStatus="PENDING"
        featured={false}
        lifecycleRevision={4}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This listing changed",
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });
});
