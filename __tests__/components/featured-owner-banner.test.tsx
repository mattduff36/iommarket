// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FeaturedOwnerBanner,
  featuredOwnerBannerStorageKey,
} from "@/components/marketplace/featured-owner-banner";

vi.mock("@/components/marketplace/featured-upgrade-button", () => ({
  FeaturedUpgradeButton: ({ pendingReview }: { pendingReview?: boolean }) => (
    <button type="button">
      {pendingReview ? "Feature for £5.00 after approval" : "Feature for £5.00"}
    </button>
  ),
}));

describe("FeaturedOwnerBanner", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("dismisses from the keyboard and remembers that choice for the listing", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <FeaturedOwnerBanner listingId="listing-1" featuredUpgradePricePence={500} pendingReview />,
    );

    expect(screen.getByRole("complementary", { name: "Feature this listing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feature for £5.00 after approval" })).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "Dismiss featured offer" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("complementary", { name: "Feature this listing" })).not.toBeInTheDocument();
    expect(localStorage.getItem(featuredOwnerBannerStorageKey("listing-1"))).toBe("1");
    expect(screen.getByRole("dialog", { name: "Upgrade later" })).toHaveTextContent("My listings");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Upgrade later" })).not.toBeInTheDocument();

    unmount();
    render(<FeaturedOwnerBanner listingId="listing-1" featuredUpgradePricePence={500} />);
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "Feature this listing" })).not.toBeInTheDocument();
    });
  });

  it("explains a later upgrade and closes that dialog from the keyboard", async () => {
    const user = userEvent.setup();
    render(<FeaturedOwnerBanner listingId="listing-2" featuredUpgradePricePence={500} />);

    await user.click(screen.getByRole("button", { name: "How to upgrade later" }));
    const dialog = screen.getByRole("dialog", { name: "Upgrade later" });
    expect(dialog).toHaveTextContent("My listings");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Upgrade later" })).not.toBeInTheDocument();
  });

  it("still dismisses when storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    render(<FeaturedOwnerBanner listingId="listing-3" featuredUpgradePricePence={500} />);

    await user.click(screen.getByRole("button", { name: "Dismiss featured offer" }));
    expect(screen.queryByRole("complementary", { name: "Feature this listing" })).not.toBeInTheDocument();
  });
});
