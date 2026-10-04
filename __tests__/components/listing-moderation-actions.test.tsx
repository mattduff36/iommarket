// @vitest-environment jsdom
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

    await userEvent.click(screen.getByRole("button", { name: "Actions for this listing" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This listing changed",
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("does not submit a prohibited rejection until a specific reason is chosen", async () => {
    render(
      <ListingModerationActions
        listingId="listing-1"
        currentStatus="PENDING"
        featured={false}
        lifecycleRevision={4}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Actions for this listing" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reject" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Reason category" }),
      "Prohibited item",
    );

    expect(screen.getByRole("combobox", { name: "Specific moderation reason" })).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "Stolen vehicle or no authority to advertise" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(moderateListing).not.toHaveBeenCalled();
  });

  it("submits the prohibited subreason the moderator explicitly selects", async () => {
    vi.mocked(moderateListing).mockResolvedValue({ data: { id: "listing-1" } } as never);
    render(
      <ListingModerationActions
        listingId="listing-1"
        currentStatus="PENDING"
        featured={false}
        lifecycleRevision={4}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Actions for this listing" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reject" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Reason category" }),
      "Prohibited item",
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Specific moderation reason" }),
      "Unsupported goods, services, parts, or plates",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(moderateListing).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "listing-1",
        action: "REJECT",
        expectedRevision: 4,
        reasonCode: "PROHIBITED",
        moderationSubReason: "prohibited.unsupported-goods",
        moderationTaxonomyVersion: "2026-08-17.1",
      }),
    );
  });
});
