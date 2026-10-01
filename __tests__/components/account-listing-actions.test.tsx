// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountListingActions } from "@/components/account/account-listing-actions";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const markSoldMock = vi.fn();
const withdrawMock = vi.fn();
const renewMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));

vi.mock("@/actions/listings", () => ({
  markListingAsSold: (...args: unknown[]) => markSoldMock(...args),
  withdrawListingSubmission: (...args: unknown[]) => withdrawMock(...args),
  renewListing: (...args: unknown[]) => renewMock(...args),
}));

vi.mock("@/components/marketplace/featured-upgrade-button", () => ({
  FeaturedUpgradeButton: () => <button type="button">Feature</button>,
}));

const liveListing = {
  listingId: "listing-1",
  title: "Island runabout",
  status: "LIVE",
  featured: false,
  dealerId: "dealer-1",
  lifecycleRevision: 3,
  hasListingPayment: true,
  featuredUpgradePricePence: 500,
  checkoutUnavailable: false,
};

describe("AccountListingActions", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
    markSoldMock.mockReset();
    withdrawMock.mockReset();
    renewMock.mockReset();
  });

  it("keeps Feature outside the menu and asks before marking sold", async () => {
    const user = userEvent.setup();
    markSoldMock.mockResolvedValue({ data: { status: "SOLD" } });
    render(<AccountListingActions {...liveListing} />);

    const feature = screen.getByRole("button", { name: "Feature" });
    expect(feature).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Feature" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for Island runabout" }));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["View", "Edit", "Mark as sold"]);
    expect(feature).toBeVisible();

    await user.click(screen.getByRole("menuitem", { name: "Mark as sold" }));
    expect(markSoldMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Mark as sold" })).toHaveTextContent(
      "This cannot be undone.",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(markSoldMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Actions for Island runabout" }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as sold" }));
    await user.click(screen.getByRole("button", { name: "Mark as sold" }));

    await waitFor(() => expect(markSoldMock).toHaveBeenCalledTimes(1));
    expect(markSoldMock).toHaveBeenCalledWith("listing-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Marked as sold.");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an actionable error and allows one retry after a failed sale", async () => {
    const user = userEvent.setup();
    markSoldMock
      .mockResolvedValueOnce({ error: "Only live listings can be marked as sold" })
      .mockResolvedValueOnce({ data: { status: "SOLD" } });
    render(<AccountListingActions {...liveListing} />);

    await user.click(screen.getByRole("button", { name: "Actions for Island runabout" }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as sold" }));
    await user.click(screen.getByRole("button", { name: "Mark as sold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only live listings can be marked as sold",
    );

    await user.click(screen.getByRole("button", { name: "Actions for Island runabout" }));
    await user.click(screen.getByRole("menuitem", { name: "Mark as sold" }));
    await user.click(screen.getByRole("button", { name: "Mark as sold" }));
    await waitFor(() => expect(markSoldMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Marked as sold.");
  });

  it("requires confirmation before withdrawing and disables a repeat confirm", async () => {
    const user = userEvent.setup();
    let resolveWithdraw: ((value: { data: { status: string } }) => void) | undefined;
    withdrawMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWithdraw = resolve;
        }),
    );
    render(
      <AccountListingActions
        {...liveListing}
        status="PENDING"
        featured
        title="Awaiting review"
      />,
    );

    expect(screen.queryByRole("button", { name: "Feature" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions for Awaiting review" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View",
      "Withdraw submission",
    ]);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Actions for Awaiting review" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Actions for Awaiting review" }));
    await user.click(screen.getByRole("menuitem", { name: "Withdraw submission" }));
    const confirm = screen.getByRole("button", { name: "Withdraw submission" });
    await user.click(confirm);
    await user.click(confirm);

    expect(withdrawMock).toHaveBeenCalledTimes(1);
    expect(withdrawMock).toHaveBeenCalledWith({
      listingId: "listing-1",
      expectedRevision: 3,
    });
    expect(screen.getByRole("button", { name: "Withdrawing…" })).toBeDisabled();

    resolveWithdraw?.({ data: { status: "DRAFT" } });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/sell/dealer?draft=listing-1"),
    );
  });

  it("renews an expired private listing once and acknowledges checkout", async () => {
    const user = userEvent.setup();
    renewMock.mockResolvedValue({ data: { status: "EXPIRED" } });
    render(
      <AccountListingActions
        {...liveListing}
        status="EXPIRED"
        dealerId={null}
        hasListingPayment={false}
        title="Expired boat"
      />,
    );

    expect(screen.queryByRole("button", { name: "Feature" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions for Expired boat" }));
    await user.click(screen.getByRole("menuitem", { name: "Renew listing (payment required)" }));

    await waitFor(() => expect(renewMock).toHaveBeenCalledTimes(1));
    expect(renewMock).toHaveBeenCalledWith("listing-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Opening renewal checkout.");
    expect(pushMock).toHaveBeenCalledWith("/sell/checkout?listing=listing-1&flow=private");
  });

  it("offers Featured outside the menu for a pending free listing", async () => {
    const user = userEvent.setup();
    render(
      <AccountListingActions
        {...liveListing}
        status="PENDING"
        featured={false}
        dealerId={null}
        hasListingPayment={false}
        title="Awaiting review"
      />,
    );

    const feature = screen.getByRole("button", { name: "Feature" });
    expect(feature).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Actions for Awaiting review" }));
    expect(screen.queryByRole("menuitem", { name: "Feature" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View",
      "Withdraw submission",
    ]);
  });

  it("shows the pending approval state after Featured is purchased", () => {
    render(
      <AccountListingActions
        {...liveListing}
        status="PENDING"
        featured={false}
        featuredPurchased
        title="Awaiting review"
      />,
    );

    expect(screen.getByText("Featured purchased — starts after approval")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Feature" })).not.toBeInTheDocument();
  });

  it("does not offer Featured for a sold listing", () => {
    render(<AccountListingActions {...liveListing} status="SOLD" title="Sold boat" />);

    expect(screen.queryByRole("button", { name: "Feature" })).not.toBeInTheDocument();
  });
});
