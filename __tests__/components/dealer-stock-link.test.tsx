// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DealerStockLink } from "@/components/marketplace/dealer-stock-link";
import { trackMarketplaceEvent } from "@/lib/analytics/track-client";

vi.mock("@/lib/analytics/track-client", () => ({ trackMarketplaceEvent: vi.fn() }));

it("opens the dealer listing in a new tab and attributes the click", () => {
  render(<DealerStockLink href="https://bvsvehicles.com/detail/123" dealerName="BVS" dealerId="d1" listingId="l1" />);
  const link = screen.getByRole("link", { name: "View on BVS’s website" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("href")).toBe("https://bvsvehicles.com/detail/123");
  fireEvent.click(link);
  expect(trackMarketplaceEvent).toHaveBeenCalledWith("dealer_stock_link_clicked", { dealer_id: "d1", listing_id: "l1" });
});
